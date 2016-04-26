#!/bin/sh
#
# create-iceowl-l10n-tarball.sh
# Porpose:
# Create an upstream tarball from the Lightning xpi language packs.
# Current stable and beta version can be found on
#    https://addons.mozilla.org/de/thunderbird/addon/lightning/versions/

EXIT_SUCCESS=0
EXIT_FAILURE=1

# Initialize our own variables:
VERBOSE=0
FILE=""
ARG_COUNT=0
LANG_COUNT=0
CURDIR_FULL=`pwd`
CURDIR=$(basename `pwd`)

# default package name
XPI=lightning.xpi
SRCPKG="iceowl-l10n"

# local functions
usage () {
cat << EOF

Usage: ${0##*/} [-h|-vd] [-e BETA_VER] VERSION

    -h         display this help and exit
    -v         verbose mode, increase the output messages
    -d         download given [VERSION]
    -e         download [BETA_VER] from the beta versions
                 (Used in combination with '-d' to get beta marked upstream
                  versions.)

    [BETA_VER] given beta version of the upstream TB version, it will be re
                 calculated into the correct Lightning version

    [VERSION]  given version in Debian format for downloading and/or creating
                 the *.orig.tar.xz

Examples:
  ${0##*/} -d 45.1
    Download version '45.1' of the Lightning l10n packages from Mozilla and creates
    a file 'icedove-45.1.orig-iceowl-l10n.tar.xz' that can be imported with
    'git-import-orig'.

  ${0##*/} -de 45.1b1 45.1~b1
    Download the beta version '45.1b1' of the Lightning l10n packages from Mozilla
    and created a file 'icedove-45.1~b1.orig-iceowl-l10n.tar.xz'. This file can be
    automatically imported with 'git-import-orig'.

EOF
}

debug () {
if [ "${VERBOSE}" = "1" ]; then
    echo "DEBUG -> $1"
fi
}

fail () {
    echo $*
    exit ${EXIT_FAILURE}
}

########################
# We are starting here #
########################

# check for wget, curl and python2
test -f /usr/bin/wget || fail "wget is missing, please install first!"
test -f /usr/bin/curl || fail "curl is missing, please install first!"
test -f /usr/bin/python || fail "python2 is missing, please install first!"

# check if we are inside iceowl-l10n/ and have a git environment
#if [ "${CURDIR}" != "${SRCPKG}" ]; then
if [ "${CURDIR}" != "icedove" ]; then
    echo "Not in icedove/.."
    exit ${EXIT_FAILURE}
else
    if [ ! -d .git ]; then
        echo "no directory .git/ found! You are in the correct directory?"
        exit ${EXIT_FAILURE}
    fi
fi

# we have no options found?
if [ "$#" -le 1 ]; then
    echo "You need at least one option!" >&2
    echo
    usage ${EXIT_FAILURE}
fi

OPTIND=1 # Reset is necessary if getopts was used previously in the script. It is a good idea to make this local in a function.
while getopts "hvde:" opt; do
    case "${opt}" in
        h)  HELP=1
            usage
            exit
            ;;
        v)  echo "[[ ... using verbose mode ... ]]"
            VERBOSE=1
            debug "found option '-v'"
            ;;
        d)  DOWNLOAD=yes
            debug "found option '-d'"
            ;;
        e)  BETA_VER=${OPTARG}
            EXPERIMENTAL=1
            debug "found option '-e' with given BETA_VER: ${BETA_VER}"
            ;;
        :)  "Option -${OPTARG} requires an argument." >&2
            exit 1
            ;;
        '?')
            usage >&2
            exit 1
            ;;
    esac
done

# shift found options
shift $(( OPTIND - 1 ))

# looping the arguments, we should have at least only one without an option!
for ARG; do
    ARG_COUNT=`expr ${ARG_COUNT} + 1`
    debug "given argument: ${ARG}"
    debug "ARG_COUNT = ${ARG_COUNT}"
done
if [ "${ARG_COUNT}" = "0" ]; then
    echo "missing argument for VERSION!"
    exit ${EXIT_FAILURE}
elif [ "${ARG_COUNT}" != "1" ]; then
    echo "more than one argument for VERSION given!"
    exit ${EXIT_FAILURE}
fi

# o.k. the last argument should be the version
VERSION=${ARG}
TB_VERSION=${VERSION}

debug "Download xpi: ........ ${DOWNLOAD:-off}"
if [ "${BETA_VER}" != "" ]; then
    debug "Upstream TB version: . ${BETA_VER}"
    TB_VERSION=${BETA_VER}
fi
LN_VERSION=`echo $(python calendar/lightning/build/makeversion.py ${TB_VERSION})`
debug "Debian version: ...... ${VERSION}"
debug "Lightning version: ... ${LN_VERSION}"

# creating temporary directories inside /tmp
# UNPACKDIR -> the directory there the original 'lightning.xpi' or the single
#            'lightning-${LN_VERSION}.$LANG.linux-i686.xpi' will be extracted, it
#             contains the complete content of the lightning.xpi
# ORIGDIR   -> the directory for the plain needed content of the ${LANG}.jar,
#              will be used for the debian.orig.tar.xz

export TMPDIR=$(mktemp --tmpdir=/tmp -d)/
       UNPACKDIR=${TMPDIR}unpack/
       ORIGDIR="${TMPDIR}${SRCPKG}-${VERSION}/${SRCPKG}"

# download Lightning from the CDN of Mozilla
if [ -n "${DOWNLOAD}" ]; then
    rm -f ${XPI}
    if [ -n "${EXPERIMENTAL}" ]; then
        # The beta Lightning packages can have various builds for one version,
        # we want at least the last build of a beta version. Also there are
        # packages for every single language instead of one single file without
        # all languages.
        # getting the latest build inside a release candidates
        RET=`curl --silent http://download.cdn.mozilla.net/pub/calendar/lightning/candidates/${LN_VERSION}-candidates/ \
             | grep "build" | awk '{print $2}' | tr '<>/"' ' ' | awk '{print $8}' | tail -1`
        if [ "$?" = "0" -a "${RET}" != "" ]; then
            DIRECTORY=`echo ${RET} | tr ' ' '\n' | head -1`
            DATE=`echo ${RET} | tr ' ' '\n' | tail -1`
            debug "found directory '${LN_VERsion}-candidates/${DIRECTORY}' from '${DATE}'"
            debug "creating ${UNPACKDIR}"
            mkdir ${UNPACKDIR}
            debug "going downloading *.xpi files from http://download.cdn.mozilla.net/pub/calendar/lightning/candidates/${LN_VERSION}-candidates/${DIRECTORY}/linux-i686/"
            cd /tmp
            # going to download the files, creating a list of the XPI files first
            XPI_LIST=`curl --silent http://download.cdn.mozilla.net/pub/calendar/lightning/candidates/${LN_VERSION}-candidates/${DIRECTORY}/linux-i686/ | grep "lightning-" | awk '{print $2}' | tr '<>"' ' ' | awk '{print $2}'`
            for i in ${XPI_LIST}; do
                wget -m -r -l 1 -A xpi http://download.cdn.mozilla.net/${i}
            done

            # unpack alle files
            for XPIFILE in `ls download.cdn.mozilla.net/pub/calendar/lightning/candidates/${LN_VERSION}-candidates/${DIRECTORY}/linux-i686/lightning-*.*.linux-i686.xpi`; do
                LANG=`basename ${XPIFILE} | sed s/lightning-${LN_VERSION}.// | sed s/.linux-i686.xpi//`
                debug "extracting '`basename ${XPIFILE}`' to '${UNPACKDIR}/${LANG}'"
                mkdir ${UNPACKDIR}/${LANG}
                unzip -q -o -d ${UNPACKDIR}/${LANG} ${XPIFILE} || fail "Oops! Failed to unzip ${XPIFILE}"
            done
            cd ${TMPDIR}
        else
            fail "Couldn't find version ${LN_VERSION}, correct version for option '-e' selected?"
        fi
    else
        # getting the stable version
        wget -O${XPI} http://download.cdn.mozilla.net/pub/calendar/lightning/releases/${LN_VERSION}/linux/${XPI}
        XPI=$(readlink -f ${XPI})
        echo "XPI saved to: ${XPI}"
    fi
else
    if [ "${FILE}" != "" ]; then
        # we should have a local *.xpi file
        XPI=${FILE}
    fi
fi

debug "creating ${ORIGDIR}"
mkdir ${ORIGDIR}

if [ "$EXPERIMENTAL" != "1" ]; then
    # don't try to do anything if we have download beta versions'
    # FIXME --> this wont with version 4.0 or greater <-- needs to be fixed
    # with the release of 4.0
    unzip -q -d ${UNPACKDIR} ${XPI} || fail "Oops! Failed to unzip ${XPI}"
fi

# getting the versions
ICEDOVE_VER=$(grep -A2 '{3550f703-e582-4d05-9a08-453d09bdfdc6}' ${UNPACKDIR}/en-US/install.rdf)

# shipped with iceowl-extension already, removing the folder 'en-US'
debug "removing language 'en-US' ${UNPACKDIR}en-US"
rm -rf ${UNPACKDIR}en-US

LANG=`ls ${UNPACKDIR}`
debug "moving extracted source into directory for tarball creation"
for i in ${LANG}; do
    echo "processing ${ORIGDIR}/locale/${i}"
    TARGET_DIR=${ORIGDIR}/${i}/locale/${i}
    # creating the folder for the localization
    mkdir -p ${TARGET_DIR}
    # move the files from the extracted source into the target
    debug "moving files ${i}/chrome/calendar-${i}/locale/${i}/calendar"
    debug "moving files ${i}/chrome/calendar-${i}/locale/${i}/lightning"
    debug "        into ${TARGET_DIR}"
    mv ${UNPACKDIR}${i}/chrome/calendar-${i}/locale/${i}/calendar ${TARGET_DIR}
    mv ${UNPACKDIR}${i}/chrome/lightning-${i}/locale/${i}/lightning ${TARGET_DIR}
done

debug "creating 'icedove_${VERSION}.orig-${SRCPKG}.tar.xz'"
TARBALL="../icedove_${VERSION}.orig-${SRCPKG}.tar.xz"
cd ${ORIGDIR}/..
tar Jcf ${TARBALL} ${SRCPKG}
TARBALL=$(readlink -f ${TARBALL})

echo
echo "Icedove version information"
echo ${ICEDOVE_VER}

# counting languages
LANG_COUNT=`ls -l ${ORIGDIR} | wc -l`

# moving *-orig-*.tar.xz back
cd ${CURDIR_FULL}
mv $TARBALL ../
TARBALL=$(readlink -f ../icedove_${VERSION}.orig-${SRCPKG}.tar.xz)
echo
echo "Tarball created in:"
echo "  -> ${TARBALL} <-"
echo "     (language count: ${LANG_COUNT})"

# always remove temporary things
debug "cleanup ..."
rm -rf ${TMPDIR}

echo "done."

exit $EXIT_SUCCESS
