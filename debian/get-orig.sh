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

VERSION=$1
ALLXPI=`wget http://mirror.switch.ch/ftp/mirror/mozilla/thunderbird/releases/$VERSION/linux-i686/xpi -O - | grep ".xpi</a>" | awk -F\" '{ print $10 }'`
CURDIR=`pwd`

for XPI in $ALLXPI; do
    LOCALE=`basename $XPI .xpi`
    rm -rf $CURDIR/upstream/$LOCALE
    mkdir $CURDIR/upstream/$LOCALE
    wget -O $CURDIR/upstream/$XPI -4 http://releases.mozilla.org/pub/mozilla.org/thunderbird/releases/$VERSION/linux-i686/xpi/$XPI
    unzip -o -q -d $CURDIR/upstream/$LOCALE $CURDIR/upstream/$XPI
    cd $CURDIR/upstream/$LOCALE
    if [ -f chrome/$LOCALE.jar ]; then
        JAR=$LOCALE.jar
    else
        JAR=`echo $XPI | sed --posix 's|-.*||'`.jar
    fi
    unzip -o -q -d chrome chrome/$JAR
    rm -f chrome/$JAR
    rm $CURDIR/upstream/$XPI
    cd $CURDIR/upstream
done
