#!/bin/sh

set -e

echo -n "Checking if we can run xpcshell..."

LD_LIBRARY_PATH=/usr/lib/icedove/ \
/usr/lib/icedove-devel/sdk/bin/xpcshell \
  -g /usr/share/icedove/ debian/tests/xpcshellTest.js

echo "done."
