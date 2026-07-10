"""Processor registry — import and call process(trade_date) for any key."""

from . import fo, eq_bhav, cm_bhav, fii, participant, fo_volt, mkt_act, fo_contracts, cm_securities

REGISTRY = {
    "fo":          fo.process,
    "eq_bhav":     eq_bhav.process,
    "cm_bhav":     cm_bhav.process,
    "fii":         fii.process,
    "participant": participant.process,
    "fo_volt":     fo_volt.process,
    "mkt_act":     mkt_act.process,
    "fo_contracts":fo_contracts.process,
    "cm_security": cm_securities.process,
}


def run(key: str, trade_date: str):
    fn = REGISTRY.get(key)
    if fn is None:
        raise ValueError(f"Unknown processor: {key!r}")
    fn(trade_date)