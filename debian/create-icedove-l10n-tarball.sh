#!/bin/sh
#
# create-upstream-tarball.sh
# Porpose: create an upstream tarball from the language pack xpi files
# Current stable and beta versions of the l10n files can be found on
#    https://download-origin.cdn.mozilla.net/pub/thunderbird
#
# The script can handle both versions. The option for automatically import the
# *.orig.tar.xz may be broken and isn't tested!

EXIT_SUCCESS=0
EXIT_FAILURE=1

# Initialize our own variables:
VERBOSE=0
FILE=""
ARG_COUNT=0
LANG_COUNT=0
CURDIR_FULL=`pwd`
CURDIR=$(basename `pwd`)
MOZILLA_CDN_PROTO="https://"
MOZILLA_CDN_BASE="download-origin.cdn.mozilla.net/pub/thunderbird/"

# default package name in case the have a local file
XPI=lightning.xpi
# base package name
SRCPKG="icedove"

# local functions
usage () {
cat << EOF

Usage: ${0##*/} [-h|-vd] [-e BETA_VER] VERSION
The options have to be used in the correct order!

    -h         display this help and exit
    -v         verbose mode, increase the output messages
    -d         download given [VERSION]
    -e         download [BETA_VER] from the beta versions
                 (Used in combination with '-d' to get beta marked upstream
                  versions.)
    [VERSION]  given version in Debian format for downloading and/or creating
                 the *.orig.tar.xz

Examples:
  ${0##*/} -d 45.0

    Download version '45.0' of the locales for Thunderbird from Mozilla and
    creates a file 'icedove_45.0.orig-icedove-l10n.tar.xz'.


  ${0##*/} -de 45.0b1 45.0~b1

    Download the beta version '45.0b1' of the locales for Thunderbird from
    Mozilla and create a file 'icedove_45.0~b1.orig-icedove-l10n.tar.xz'.


  ${0##*/} -vde 45.0b1 45.0~b1

    Same as above, download the beta version '45.0b1' of the locales for
    Thunderbird from Mozilla and create a file
    'icedove_45.0~b1.orig-icedove-l10n.tar.xz'.
    But this is done with some verbose output messages to see what's going
    on inside. Mostly useful for debugging the script.

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

# check for wget and curl
test -f /usr/bin/wget || fail "wget is missing, please install first!"
test -f /usr/bin/curl || fail "curl is missing, please install first!"

# check if we are inside icedove-l10n/ and have a git environment
if [ "${CURDIR}" != "${SRCPKG}" ]; then
    echo "Not in ${SRCPKG}/.."
    exit ${EXIT_FAILURE}
else
    if [ ! -d .git ]; then
        echo "no directory .git/ found! You are in the correct directory?"
        exit ${EXIT_FAILURE}
    fi
fi

# we have no options found?
if [ $(($#)) -lt 1 ]; then
    echo "You need at least one option!" >&2
    echo
    usage ${EXIT_FAILURE}
fi

OPTIND=1 # Reset is necessary if getopts was used previously in the script. It is a good idea to make this local in a function.
while getopts "hvde:" opt; do
    case "$opt" in
        h)  HELP=1
            usage
            exit
            ;;
        v)  echo "[[ ... using verbose mode ... ]]"
            VERBOSE=1
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

# there is no argument left that should be the Debian version, error out!
if [ "${ARG_COUNT}" = "0" ]; then
    echo "missing argument for VERSION!"
    exit ${EXIT_FAILURE}

# we have to many arguments, error out
elif [ "${ARG_COUNT}" != "1" ]; then
    echo "more than one argument for VERSION given!"
    exit ${EXIT_FAILURE}
fi

# o.k. the last argument should be the version
VERSION=${ARG}

debug "Download xpi: ........ ${DOWNLOAD:-off}"
debug "Run git-import-orig: . ${GIT_IMPORT:-off}"
if [ -n ${BETA_VER} ]; then
    debug "Upstream beta version: ${BETA_VER}"
fi
debug "Debian version: ...... ${VERSION}"

# creating temporary directories inside /tmp
# TMPDIR      -> the 'base' directory there we build all the stuff
# UPSTREAMDIR -> the directory there the original '*.xpi' will be extracted,
#                it contains the complete content of the various *.xpi files,
#                we also unpack here the *.xpi files
# ORIGDIR     -> the directory for the plain needed content of the ${LANG}.jar,
#                will be used for the debian.orig.tar.xz

export TMPDIR=$(mktemp --tmpdir=/tmp -d)/
       UPSTREAMDIR=${TMPDIR}upstream/
       ORIGDIR="${TMPDIR}${SRCPKG}-${VERSION}/"

# download Lightning from the CDN of Mozilla
if [ -n "${DOWNLOAD}" ]; then
    # remove a lightning.xpi if present
    rm -f ${XPI}
    if [ -n "${EXPERIMENTAL}" ]; then

        #########################################################################
        # The beta Lightning packages can have various builds for one version,  #
        # we want at least the last build of a beta version. Also there are     #
        # packages for every single language instead of one single file without #
        # all languages.                                                        #
        #########################################################################

        # getting the latest build inside a release candidates
        debug "try at ${MOZILLA_CDN_PROTO}${MOZILLA_CDN_BASE}candidates/${BETA_VER}-candidates/ "
        RET=`curl ${MOZILLA_CDN_PROTO}${MOZILLA_CDN_BASE}candidates/${BETA_VER}-candidates/ \
             | grep ">build" | awk '{print $2}' | tr '<>/"' ' ' | awk '{print $6}' | tail -n 1`

        # going further if we found something useful
        if [ "$?" = "0" -a "${RET}" != "" ]; then
            # DIRECTORY is the 'build[x]' directory on the CDN, e.g. 'build1', 'build2', ...
            DIRECTORY=`echo ${RET} | tr ' ' '\n' | head -1`
            # DATE is the date of the DIRECTORY folder
            DATE=`echo ${RET} | tr ' ' '\n' | tail -1`
            debug "found directory '${BETA_VER}-candidates/${DIRECTORY}' from '${DATE}'"
            debug "creating ${UPSTREAMDIR}"
            mkdir ${UPSTREAMDIR}
            cd /tmp
            # checking if there is already some download
            if [ ! -d ${MOZILLA_CDN_BASE}/candidates/${BETA_VER}-candidates/${DIRECTORY}/linux-i686/xpi ]; then
                DO_DOWNLOAD="1"
            fi

            if [ -d ${MOZILLA_CDN_BASE}/candidates/${BETA_VER}-candidates/${DIRECTORY}/linux-i686/xpi ]; then
                if [ "$(`ls -l ${MOZILLA_CDN_BASE}/candidates/${BETA_VER}-candidates/${DIRECTORY}/linux-i686/xpi | wc -l`)" = "0" ]; then
                    debug "found old download folder, but it's empty"
                    DO_DOWNLOAD="1"
                fi
            fi
            if [ "${DO_DOWNLOAD}" = "1" ]; then
                debug "going downloading *.xpi files from ${MOZILLA_CDN_PROTO}${MOZILLA_CDN_BASE}/candidates/${BETA_VER}-candidates/${DIRECTORY}/linux-i686/"
                wget -m -r -l 1 -A xpi ${MOZILLA_CDN_PROTO}${MOZILLA_CDN_BASE}/candidates/${BETA_VER}-candidates/${DIRECTORY}/linux-i686/xpi/
                debug "copy *xpi files from donwload folder to workspace"
            fi
            # finally copy the *.xpi files to ${UPSTREAMDIR}
            cp ${MOZILLA_CDN_BASE}/candidates/${BETA_VER}-candidates/${DIRECTORY}/linux-i686/xpi/*.xpi ${UPSTREAMDIR}
            cd ${TMPDIR}
        # uhh, we couldn't find the given BETA_VER on the FTP server
        else
            fail "Couldn't find version ${BETA_VER}, correct version for option '-e' selected?"
        fi
    else

        #######################################################################
        # If we are here the user want to get a version for unstable/testing. #
        # It's the same as for beta versions, the only difference is the      #
        # download URL.                                                       #
        #######################################################################

        debug "creating ${UPSTREAMDIR}"
        mkdir ${UPSTREAMDIR}
        cd /tmp
        # checking if there is already some download
        if [ ! -d ${MOZILLA_CDN_BASE}releases/${VERSION}/linux-i686/xpi ]; then
            DO_DOWNLOAD="1"
        fi
        if [ -d ${MOZILLA_CDN_BASE}releases/${VERSION}/linux-i686/xpi ]; then
            DL_COUNT=`ls -l ${MOZILLA_CDN_BASE}releases/${VERSION}/linux-i686/xpi/*.xpi | wc -l`
            if [ "${DL_COUNT}" = "0" ]; then
                debug "found old download folder, but it's empty"
                DO_DOWNLOAD="1"
            else
                echo "nothing to download, all needed *.xpi are here"
                debug "found ${DL_COUNT} files already downloaded"
            fi
        fi
        if [ "${DO_DOWNLOAD}" = "1" ]; then
            # getting files for the  stable version
            wget -m -r -l 1 -A xpi ${MOZILLA_CDN_PROTO}${MOZILLA_CDN_BASE}releases/${VERSION}/linux-i686/xpi/
        fi
        # finally copy the *.xpi files to $(UPSTREAMDIR})
        cp ${MOZILLA_CDN_BASE}releases/${VERSION}/linux-i686/xpi/*.xpi ${UPSTREAMDIR}
    fi
else
    if [ "${FILE}" != "" ]; then
        # DUMMY! option '-f' isn't currently implemented!
        # we should have a local *.xpi file if option -f is given
        XPI=${FILE}
    fi
fi

debug "removing language 'en_US'"
rm -f ${UPSTREAMDIR}/en-US.xpi
debug "creating workspace for extracted upstream sources in '${ORIGDIR}'"
mkdir ${ORIGDIR}

# extract l10n files
debug "extracting \"\$LANG*.jar\" in \"${UPSTREAMDIR}chrome\" into \"${ORIGDIR}\$LANG\""
#LANG_COUNT_LIG=`ls -l ${UPSTREAMDIR}chrome/lightning*.jar | wc -l`

for XPI in `ls ${UPSTREAMDIR}`; do
    LOCALE=`basename ${XPI} .xpi`
    debug "creating ${UPSTREAMDIR}/${LOCALE}"
    mkdir ${UPSTREAMDIR}/${LOCALE}
    unzip -o -q -d $UPSTREAMDIR/$LOCALE $UPSTREAMDIR/$XPI
    # use more verbose mode if we do some debugging, comment the line above if needed
    #unzip -o -d $UPSTREAMDIR/$LOCALE $UPSTREAMDIR/$XPI
    cd $UPSTREAMDIR/$LOCALE
    if [ -f chrome/$LOCALE.jar ]; then
        JAR=$LOCALE.jar
    else
        JAR=`echo $XPI | sed --posix 's|-.*||'`.jar
    fi
    if [ -f chrome/$JAR ]; then
        unzip -o -q -d chrome chrome/$JAR
        rm -f chrome/$JAR
    fi
    # removing the not needed any longer *.xpi files
    rm $UPSTREAMDIR/$XPI
done

cd ${TMPDIR}
mv upstream ${SRCPKG}-${VERSION}/icedove-l10n
# counting languages
LANG_COUNT=`ls ${SRCPKG}-${VERSION}/icedove-l10n/ | wc -l`

# doing the *.orig.tar.xz archive stuff
TARBALL="${SRCPKG}_${VERSION}.orig-${SRCPKG}-l10n.tar.xz"
debug "creating archive: '${TARBALL}' in '${TMPDIR}'"
cd ${SRCPKG}-${VERSION}
tar caf ${TARBALL} icedove-l10n
TARBALL=$(readlink -f ${TARBALL})

# moving orig.tar.xz back to the users working dir
cd ${CURDIR_FULL}
debug "moving ${TARBALL} to ${CURDIR_FULL}/../"
mv ${TARBALL} ../
TARBALL_FINAL=$(readlink -f ../${SRCPKG}_${VERSION}.orig-${SRCPKG}-l10n.tar.xz)
echo
echo "Tarball created in:"
echo "  -> ${TARBALL_FINAL} <- (containing ${LANG_COUNT} languages)"

# remove temporary things if no verbose mode
if [ ${VERBOSE} = "" ]; then
    debug "cleanup ${TMPDIR} ..."
    rm -rf ${TMPDIR}
else
    debug "NOT cleaning up ${TMPDIR}"
fi

echo "done."

exit $EXIT_SUCCESS
