"""Send one command to the Subby panel's dev bridge and print the result.

Usage: python3 send.py ACTION ['{"json": "args"}'] [--timeout SECONDS]
The panel (premiere-panel/main.js) polls command.json and writes result.json.
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CMD = os.path.join(HERE, "command.json")
RES = os.path.join(HERE, "result.json")


def main():
    argv = sys.argv[1:]
    timeout = 120.0
    if "--timeout" in argv:
        i = argv.index("--timeout")
        timeout = float(argv[i + 1])
        del argv[i:i + 2]
    action = argv[0]
    args = json.loads(argv[1]) if len(argv) > 1 else {}

    last = 0
    try:
        with open(CMD) as f:
            last = int(json.load(f).get("id") or 0)
    except (OSError, ValueError):
        pass
    cmd_id = max(last, int(time.time() * 1000) % 10**9) + 1

    tmp = CMD + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"id": cmd_id, "action": action, "args": args}, f)
    os.replace(tmp, CMD)

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with open(RES) as f:
                res = json.load(f)
            if res.get("id") == cmd_id:
                print(json.dumps(res, indent=2))
                sys.exit(0 if res.get("ok") else 1)
        except (OSError, ValueError):
            pass
        time.sleep(0.3)
    status = ""
    try:
        with open(os.path.join(HERE, "status.json")) as f:
            status = f.read()
    except OSError:
        pass
    print(f"TIMEOUT after {timeout}s waiting for command {cmd_id}. Panel status: {status}")
    sys.exit(2)


if __name__ == "__main__":
    main()
