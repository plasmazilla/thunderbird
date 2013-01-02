#!/bin/bash -e
#
# Download upstream xpi files from mozilla server and extract into upstream
# folder. Must run from root of debian package.
#
# Need version number (e.g 3.0.1) as argument.

if [ "$#" -lt 1 ]; then
    echo "usage: $0 Version"
    exit 1
fi

TMPDIR=`mktemp -d /tmp/icedove-l10n.XXXXXXXXXX`
CURDIR=`pwd`
VERSION=$1

if [ -f $CURDIR/../icedove-l10n_$VERSION.orig.tar.xz ]; then
    echo "icedove-l10n_$VERSION.orig.tar.xz exists, giving up..."
    exit 1
fi

mkdir $TMPDIR/icedove-l10n-$VERSION
mkdir $TMPDIR/icedove-l10n-$VERSION/upstream
cd $TMPDIR/icedove-l10n-$VERSION

# use wget mirror mode
wget -m ftp://ftp.mozilla.org/pub/mozilla.org/thunderbird/releases/$VERSION/linux-i686/xpi
cp ftp.mozilla.org/pub/mozilla.org/thunderbird/releases/$VERSION/linux-i686/xpi/*.xpi upstream

for XPI in `ls upstream`; do
    LOCALE=`basename $XPI .xpi`
    mkdir upstream/$LOCALE
    unzip -o -q -d upstream/$LOCALE upstream/$XPI
    cd upstream/$LOCALE
    if [ -f chrome/$LOCALE.jar ]; then
        JAR=$LOCALE.jar
    else
        JAR=`echo $XPI | sed --posix 's|-.*||'`.jar
    fi
    if [ -f chrome/$JAR ]; then
        unzip -o -q -d chrome chrome/$JAR
        rm -f chrome/$JAR
    fi
    cd $TMPDIR/icedove-l10n-$VERSION
    rm upstream/$XPI
done

# en-US is integrated in icedove itself
cd $TMPDIR/icedove-l10n-$VERSION
rm -rf upstream/en-US
rm -rf ftp.mozilla.org
cd ..
tar -Jcf icedove-l10n_$VERSION.orig.tar.xz icedove-l10n-$VERSION
cp icedove-l10n_$VERSION.orig.tar.xz $CURDIR/..
rm -rf $TMPDIR/icedove-l10n-$VERSION
