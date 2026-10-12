#!/bin/zsh
# Double-click in Finder to host Night City Crew from this Mac.
cd "$(dirname "$0")" && exec python3 host_computer.py "$@"
