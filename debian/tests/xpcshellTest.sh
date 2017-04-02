#!/bin/sh

set -e

echo -n "Checking if we can run xpcshell..."

LD_LIBRARY_PATH=/usr/lib/thunderbird/ \
/usr/lib/thunderbird-devel/sdk/bin/xpcshell \
  -g /usr/share/thunderbird/ debian/tests/xpcshellTest.js

echo "done."
