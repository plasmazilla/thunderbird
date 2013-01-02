#!/bin/bash -e
#
# Download upstream xpi files from mozilla server and extract into upstream
# folder. Must run from root of debian package.
#
# Need version number (e.g 3.0.1) as argument. The optional parameter -gz
# is only usefull if you need *.tar.gz archive. This is just for backward
# compatibility with git-buildpackage in Squeeze.

if [ "$#" -lt 1 ]; then
    echo "usage: $0 Version [-gz]"
    echo "use option [-gz] if you want generate tar.gz archive"
    exit 1
fi

TMPDIR=`mktemp -d /tmp/icedove-l10n.XXXXXXXXXX`
CURDIR=`pwd`
VERSION=$1

if [ "$2" == "-gz" ]; then
    TAR_OPT="-zcf"
    TAR_EXT="tar.gz"
    if [ -f $CURDIR/../icedove-l10n_$VERSION.orig.$TAR_EXT ]; then
        echo "icedove-l10n_$VERSION.orig.$TAR_EXT exists, giving up..."
        exit 1
    fi
else
    TAR_OPT="-Jcf"
    TAR_EXT="tar.xz"
    if [ -f $CURDIR/../icedove-l10n_$VERSION.orig.$TAR_EXT ]; then
        echo "icedove-l10n_$VERSION.orig.$TAR_EXT exists, giving up..."
        exit 1
    fi
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
tar $TAR_OPT icedove-l10n_$VERSION.orig.$TAR_EXT icedove-l10n-$VERSION
cp icedove-l10n_$VERSION.orig.$TAR_EXT $CURDIR/..
rm -rf $TMPDIR/icedove-l10n-$VERSION
