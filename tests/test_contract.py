from pathlib import Path
from unittest.mock import patch
from datetime import datetime
import importlib, json, sys, pytest
from gltest.direct import VMContext, create_address, deploy_contract

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "contracts/Contract.py"
BUDGET = 1000


def eth(a):
    return "0x" + (a if isinstance(a, bytes) else a.as_bytes).hex()


@pytest.fixture
def env():
    client, vendor, stranger = [create_address(x) for x in ("client", "vendor", "stranger")]
    vm = VMContext(client)
    vm.warp("2026-10-15T00:00:00Z")
    with patch("os.unlink", lambda _: None), vm.activate():
        c = deploy_contract(FILE, vm)
        gl = c._instance.create_agreement.__globals__["gl"]
        sdk = Path(gl._cached_gl.__file__).resolve().parents[2]
        if str(sdk) not in sys.path:
            sys.path.insert(0, str(sdk))
        importlib.import_module("genlayer")
        _ = gl.nondet.web
        _ = gl.eq_principle
    with vm.activate():
        sync(vm, c)
        yield vm, c, client, vendor, stranger


def sync(vm, c):
    gl = c._instance.create_agreement.__globals__["gl"]
    sender = type(gl.message.sender_address)(vm.sender) if isinstance(vm.sender, bytes) else vm.sender
    gl._cached_gl.message = gl.message._replace(
        sender_address=sender, origin_address=sender, value=type(gl.message.value)(vm.value)
    )
    gl._cached_gl.message_raw["datetime"] = vm._datetime


def call(e, actor, name, *args, value=0):
    vm, c, *_ = e
    with vm.activate(), vm.prank(actor):
        vm.value = value
        sync(vm, c)
        return getattr(c, name)(*args)


def ts(x):
    return int(datetime.fromisoformat("2026-10-15T" + x + "+00:00").timestamp())


def terms(e, target="https://api.acme.io"):
    return {
        "title": "Ship a working status API",
        "vendor": eth(e[3]),
        "target_url": target,
        "probe_paths": ["/health", "/v1/status"],
        "checks": [
            "The /health endpoint returns HTTP 200 with a JSON status field set to ok.",
            "The /v1/status endpoint lists at least one service with an uptime value.",
        ],
        "budget": BUDGET,
        "partial_bps": 5000,
        "submit_deadline": ts("00:10:00"),
        "review_end": ts("00:20:00"),
        "expires": ts("00:30:00"),
    }


def snap():
    return {
        "target": "https://api.acme.io",
        "paths": ["/health", "/v1/status"],
        "observations": [
            {"path": "/health", "url": "https://api.acme.io/health", "status": 200,
             "content_type": "application/json", "length": 20, "body_sha256": "a" * 64, "excerpt": '{"status":"ok"}'},
            {"path": "/v1/status", "url": "https://api.acme.io/v1/status", "status": 200,
             "content_type": "application/json", "length": 40, "body_sha256": "b" * 64,
             "excerpt": '{"services":[{"name":"x","uptime":99}]}'},
        ],
    }


def funded(e, target="https://api.acme.io"):
    aid = call(e, e[2], "create_agreement", json.dumps(terms(e, target)))
    assert call(e, e[2], "fund", aid, value=BUDGET) == "FUNDED"
    e[0].deal(e[0]._contract_address, BUDGET)
    return aid


def reviewed(e, outcome="ACCEPTED", matched=None, s=None, target="https://api.acme.io"):
    if matched is None:
        matched = [0, 1] if outcome == "ACCEPTED" else ([0] if outcome == "PARTIAL" else [])
    aid = funded(e, target)
    call(e, e[3], "submit", aid)
    mod = e[1]._instance.create_agreement.__globals__
    with patch.dict(mod, {"_probe": lambda *_: s or snap(),
                          "_assess": lambda *_: {"outcome": outcome, "matched": matched}}):
        assert call(e, e[4], "review", aid) == outcome
    return aid


def test_header_and_consensus_shape():
    source = FILE.read_text()
    assert source.splitlines()[:2] == [
        "# v0.2.17",
        '# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }',
    ]
    assert "gl.eq_principle.strict_eq" not in source
    assert source.count("gl.vm.run_nondet(") >= 1
    assert "DIRECT_WALLET_REQUIRED" in source


def test_create_binds_sender_and_rejects_bad_terms(env):
    aid = call(env, env[2], "create_agreement", json.dumps(terms(env)))
    v = env[1].get_agreement(aid)
    assert v["client"] == eth(env[2]) and v["phase"] == "DRAFT" and len(v["terms_digest"]) == 64
    for mutation in ({"vendor": "0x0"}, {"target_url": "http://api.acme.io"},
                     {"target_url": "https://api.acme.io/path"}, {"probe_paths": ["relative"]},
                     {"checks": ["too short"]}, {"partial_bps": 9999}):
        bad = terms(env)
        bad.update(mutation)
        with pytest.raises(Exception):
            call(env, env[2], "create_agreement", json.dumps(bad))


def test_exact_funding_and_role_rollback(env):
    aid = call(env, env[2], "create_agreement", json.dumps(terms(env)))
    before = env[1].get_agreement(aid)
    for actor, amount in ((env[4], BUDGET), (env[2], BUDGET - 1), (env[2], BUDGET + 1)):
        with pytest.raises(Exception):
            call(env, actor, "fund", aid, value=amount)
        assert env[1].get_agreement(aid) == before
    assert call(env, env[2], "fund", aid, value=BUDGET) == "FUNDED"


def test_only_vendor_submits_before_deadline(env):
    aid = funded(env)
    before = env[1].get_agreement(aid)
    with pytest.raises(Exception):
        call(env, env[4], "submit", aid)
    assert env[1].get_agreement(aid) == before
    env[0].warp("2026-10-15T00:10:00Z")
    with pytest.raises(Exception):
        call(env, env[3], "submit", aid)
    assert env[1].get_agreement(aid) == before


def test_unreachable_endpoint_fails_closed(env):
    aid = funded(env)
    call(env, env[3], "submit", aid)
    mod = env[1]._instance.create_agreement.__globals__
    with patch.dict(mod, {"_probe": lambda *_: (_ for _ in ()).throw(ValueError("down"))}):
        assert call(env, env[4], "review", aid) == "UNREACHABLE"
    v = env[1].get_agreement(aid)
    assert v["verdict"]["result"]["outcome"] == "UNREACHABLE" and v["verdict"]["snapshot"] is None


def test_review_stores_observation_digests(env):
    aid = reviewed(env)
    obs = env[1].get_agreement(aid)["verdict"]["snapshot"]["observations"]
    assert obs and all("body_sha256" in o and "excerpt" not in o for o in obs)


def test_dispute_is_single_bounded_recheck(env):
    aid = reviewed(env, "PARTIAL")
    assert call(env, env[4], "dispute", aid, "c" * 64) == "DISPUTED"
    state = env[1].get_agreement(aid)
    with pytest.raises(Exception):
        call(env, env[4], "dispute", aid, "d" * 64)
    assert env[1].get_agreement(aid) == state
    mod = env[1]._instance.create_agreement.__globals__
    with patch.dict(mod, {"_probe": lambda *_: snap(), "_assess": lambda *_: {"outcome": "ACCEPTED", "matched": [0, 1]}}):
        assert call(env, env[4], "resolve", aid) == "ACCEPTED"


def test_settle_full_partial_refund(env):
    for i, (outcome, award) in enumerate((("ACCEPTED", BUDGET), ("PARTIAL", BUDGET // 2), ("REJECTED", 0))):
        aid = reviewed(env, outcome, s=snap(), target=f"https://api{i}.acme.io")
        env[0].warp("2026-10-15T00:20:00Z")
        assert call(env, env[4], "settle", aid) == outcome
        v = env[1].get_agreement(aid)
        assert v["credits"].get(eth(env[3]), {}).get("amount", 0) == award
        assert sum(x["amount"] for x in v["credits"].values()) == BUDGET
        env[0].warp("2026-10-15T00:00:00Z")


def test_settle_before_review_end_blocked(env):
    aid = reviewed(env)
    before = env[1].get_agreement(aid)
    with pytest.raises(Exception):
        call(env, env[4], "settle", aid)
    assert env[1].get_agreement(aid) == before


def test_same_target_cannot_settle_twice(env):
    # Two agreements over the identical target+paths are both reviewed before either settles.
    first = reviewed(env)
    second = reviewed(env)  # same target key; allowed until one actually settles
    env[0].warp("2026-10-15T00:20:00Z")
    assert call(env, env[4], "settle", first) == "ACCEPTED"
    before = env[1].get_agreement(second)
    with pytest.raises(Exception):
        call(env, env[4], "settle", second)
    assert env[1].get_agreement(second) == before


def test_expiry_recovery_refunds_client(env):
    aid = funded(env)
    env[0].warp("2026-10-15T00:30:00Z")
    assert call(env, env[4], "recover_expired", aid) == "REFUND_AVAILABLE"
    v = env[1].get_agreement(aid)
    assert v["credits"] == {eth(env[2]): {"amount": BUDGET, "payout_amount": 0,
                                          "refund_amount": BUDGET, "kind": "REFUND", "status": "AVAILABLE"}}


def test_withdraw_pays_and_tracks_accounting(env):
    aid = reviewed(env)
    env[0].warp("2026-10-15T00:20:00Z")
    call(env, env[4], "settle", aid)
    assert call(env, env[3], "withdraw", aid) == "PAID"
    v = env[1].get_agreement(aid)
    assert v["held"] == 0 and v["paid"] == BUDGET and v["credits"][eth(env[3])]["status"] == "PAID"
    with pytest.raises(Exception):
        call(env, env[3], "withdraw", aid)
