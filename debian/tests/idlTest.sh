#!/bin/sh

set -e

cleanup() {
  [ ! -d "${SCRATCHDIR}" ] || rm -rf "${SCRATCHDIR}"
}

#trap cleanup EXIT

SCRATCHDIR=`mktemp -d`
TEST_IDL_FILE="debian/tests/idlTest.idl"
TESTFILE=$(basename $0 .sh)

echo "Running tests in ${TESTFILE}"

echo -n "Test1: Make sure we can generate typelibs..."
/usr/lib/icedove-devel/sdk/bin/typelib.py \
    -I"/usr/lib/icedove-devel/idl" \
    -o "${SCRATCHDIR}/test.xpt" \
    "${TEST_IDL_FILE}"
echo "done."

echo -n "Test2: Make sure we can generate C++ headers..."
/usr/lib/icedove-devel/sdk/bin/header.py \
    -I"/usr/lib/icedove-devel/idl" \
    -o "${SCRATCHDIR}/test.h" \
    "${TEST_IDL_FILE}"
echo "done."

echo -n "Test3: Compiling generated file..."
g++ -std=c++11 \
    -I/usr/include/icedove \
    -I/usr/include/nspr    \
    -o "${SCRATCHDIR}/test.o" \
    "${SCRATCHDIR}/test.h"
echo "done."

echo "All Tests in ${TESFILE} finished succesfully."
