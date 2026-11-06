#!/usr/bin/env python3
"""Per-connection verdict from `tcpdump -nn -S -tt -v -r <pcap>` text on stdin (used by netdiag.sh).

For every client connection to :443/:8443 it says how far the TCP/TLS exchange got in the capture:
SYN → SYN-ACK → first client data (the TLS ClientHello) → first server data (the ServerHello).
Server port is 443 or 8443; everything else is treated as the client side.
"""
import collections
import re
import sys

STAMP = re.compile(r"^(\d+\.\d+) ")
LINE = re.compile(
    r"^\s*(?P<sip>\S+)\.(?P<sp>\d+) > (?P<dip>\S+)\.(?P<dp>\d+): Flags \[(?P<fl>[^\]]*)\], "
    r"(?:cksum \S+, )?(?:seq (?P<s1>\d+)(?::\d+)?, )?(?:ack \d+, )?win \d+.*?length (?P<len>\d+)"
)
SERVER_PORTS = (443, 8443)


def parse(text):
    # `tcpdump -v` prints the timestamp + IP header on one line and "src.port > dst.port: Flags …" on the next.
    recs = []
    t = 0.0
    for line in text.split("\n"):
        st = STAMP.match(line)
        if st:
            t = float(st[1])
            continue
        m = LINE.match(line)
        if m:
            recs.append((t, m["sip"], int(m["sp"]), m["dip"], int(m["dp"]), m["fl"], int(m["s1"] or 0), int(m["len"])))
    return recs


def flows_of(recs):
    flows = collections.OrderedDict()
    for t, sip, sp, dip, dp, fl, seq, ln in recs:
        from_server = sp in SERVER_PORTS
        key = (dip, dp) if from_server else (sip, sp)
        f = flows.setdefault(key, dict(syn=None, synack=None, c=[], s=[], c_seen=set(), s_seen=set(), c_retx=0, s_retx=0, rst=False, fin=False))
        if "S" in fl and from_server:
            f["synack"] = t
        elif "S" in fl:
            f["syn"] = t
        f["rst"] |= "R" in fl
        f["fin"] |= "F" in fl
        if ln > 0:
            side = "s" if from_server else "c"
            if seq in f[side + "_seen"]:
                f[side + "_retx"] += 1
            else:
                f[side + "_seen"].add(seq)
                f[side].append((t, ln))
    return flows


def verdict(f):
    if not f["syn"]:
        return "SYN not in capture (connection started before the capture)"
    if not f["synack"]:
        return "TCP handshake NOT completed (SYN seen, no SYN-ACK)"
    if not f["c"]:
        return "handshake OK, but NO data from the client: the ClientHello never reached this capture point"
    if not f["s"]:
        return f"ClientHello ({f['c'][0][1]} B) arrived; the server sent NOTHING back (client retransmits: {f['c_retx']})"
    if f["s_retx"]:
        return f"server answered ({sum(n for _, n in f['s'])} B) but retransmitted {f['s_retx']}x: the client does not ack — the return path loses packets"
    return f"data both ways (client {sum(n for _, n in f['c'])} B / server {sum(n for _, n in f['s'])} B): TLS bytes flowed"


def main():
    recs = parse(sys.stdin.read())
    if not recs:
        print("no TCP packets in the capture")
        return
    t0 = recs[0][0]
    flows = flows_of(recs)
    print(f"{len(flows)} connection(s); t = seconds from the first packet")
    for (ip, port), f in flows.items():
        t = (f["syn"] - t0) if f["syn"] else 0.0
        extra = (" [RST]" if f["rst"] else "") + (" [FIN]" if f["fin"] else "")
        print(f"- {ip}:{port}  t={t:.2f}s  {verdict(f)}{extra}")


if __name__ == "__main__":
    main()
