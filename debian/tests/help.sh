#!/bin/sh

set -e
set -x

# At least check we can execute the main binary
# to catch missing dependenies
xvfb-run icedove -help
xvfb-run icedove -version | grep -qs Icedove
