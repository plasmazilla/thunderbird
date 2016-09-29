#!/bin/sh

set -e
set -x

# At least check we can execute the main binary
# to catch missing dependenies
xvfb-run -a icedove -help
xvfb-run -a icedove --version | grep -qs Icedove
