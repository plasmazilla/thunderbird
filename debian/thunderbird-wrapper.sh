#!/bin/sh
# vim: autoindent tabstop=4 shiftwidth=4 expandtab softtabstop=4 filetype=sh textwidth=76
#
# File:
#   /usr/bin/thunderbird
#
# Purpose:
#   This is a wrapper script for starting the thunderbird binary with taking
#   care of the searching for a old user Icedove profile folder and copying
#   the folder into the new place if possible.
#
# Environment:
#   The Icedove binary was using the profile folder '${HOME}/.icedove'. The
#   Mozilla default for the Thunderbird binary is '${HOME}/.thunderbird'.
#   The script will looking for the old profile folder and will copy the
#   folder into the new used profile folder.
#
# Copyright:
#   Licensed under the terms of GPLv2+.

set -e
#set -x

#########################################
# message templates for the X11 dialogs #
#########################################

DEFAULT_X11_MSG="\
If you see this message box something went wrong while
migrating your Icedove profile(s) into the Thunderbird
profile folder!

The following error happen:"

DOT_THUNDERBIRD_EXISTS="\
${DEFAULT_X11_MSG}

An existing profile folder '.thunderbird' was found in your Home
directory '${HOME}/' while trying to migrate the Icedove
profile(s) folder!

This can probably be a old, currently not used profile folder or
you maybe using a Thunderbird installation from the Mozilla packages.
If you don't need this old profile folder you can remove or backup
this folder and start Thunderbird again.

Sorry, but please investigate the situation by yourself.

Please mind also the information in section 'Profile Migration'
given in the file

/usr/share/doc/thunderbird/README.Debian.gz
"

TITLE="Icedove to Thunderbird Profile migration"

# some global variables
MOZ_APP_NAME=thunderbird
MOZ_APP_LAUNCHER=`which $0`
MOZ_LIBDIR=/usr/lib/${MOZ_APP_NAME}
ID_PROFILE_FOLDER=${HOME}/.icedove
TB_PROFILE_FOLDER=${HOME}/.thunderbird

# set MOZ_APP_LAUNCHER for gnome-session
export MOZ_APP_LAUNCHER

# local functions
debug () {
if [ "${VERBOSE}" = "1" ]; then
    echo "DEBUG -> $1"
fi
}

usage () {
#Usage: ${0##*/} [-h|-vg|d @args|-- @args]
cat << EOF

Usage: ${0##*/} [-h|-vg|-- @args]
The options have to be used in the correct order!

    -h      display this help and exit
    -v      verbose mode, increase the output messages
    -g      starts Thunderbird within gdb (needs package thunderbird-dbg!)
EOF
#    -d      starts Thunderbird with specific debugger
cat << EOF

Examples:

 ${0##*/} -h

    Writes this help messages on stdout. If any other options is given they
    will be ignored.

 ${0##*/} -v

    Enable some debug messages on stdout. Only useful while developing then
    thunderbird packages or while the profile migration to see some more
    messages on stdout.

 ${0##*/} -g

    Starts Thunderbird in a GDB session if packages gdb and thunderbird-dbg
    is installed.
EOF
# other debuggers will be added later, we need maybe a seperate valgrind
# package! Note MDN site for valgrind https://developer.mozilla.org/en-US/docs/Mozilla/Testing/Valgrind
# ${0##*/} -d gdb
#    The same as above, only manually specified the GDB debugging tool as
#    argument. Note that you probably will need additional parameter to
#    enable e.g. writing to a logfile.
#    It's also possible to specify valgrind, that will need to add additional
#    quoted arguments in any case!
#    The thunderbird binary must be compiled with valgrind support if you
#    want to use valgrind here!
#
#      ${0##*/} -d 'valgrind --arg1 --arg2' -- -thunderbird-arg1
cat << EOF

 ${0##*/} -- @args

    Adding some thunderbird command line specific arguments, like e.g.
    calling the ProfileManager or safe-mode in case of trouble. Would look
    like this if you need to run in safe-mode with the JS Error console,
    that can be combined with the -g or -d option:

      ${0##*/} -- --safe-mode --jsconsole

    Or to see the possible arguments for thunderbird that could be added
    here:

      ${0##*/} -- -h

EOF
}

# end local functions

# Reset is necessary if getopts was used previously in the script. It is a
# good idea to make this local in a function.
OPTIND=1

while getopts "hvgd:" opt; do
    case "$opt" in
        h)  HELP=1
            usage
            exit 0
            ;;
        v)  echo "[[ ... using verbose mode ... ]]"
            VERBOSE=1
            ;;
        g)
            DEBUGGER=1
            DEBUG=1
            shift
            ;;
#        d)
#            USER_DEBUGGER=$2
#            DEBUG=1
#            ;;
        '?')
            usage >&2
            exit 1
            ;;
        --) # Stop option processing
            shift
            break
            ;;
        *)
            break
            ;;
    esac
done

# shift found options
shift $(( OPTIND - 1 ))

THUNDERBIRD_OPTIONS="$@"

# sanity check
if [ "$DEBUGGER" != "" ] && [ "$USER_DEBUGGER" != "" ]; then
    echo "You can't use option '-g and '-d' at the same time!"
    usage
    exit 1
fi

# trying to get the DE
if [ "${XDG_CURRENT_DESKTOP}" = "" ]; then
    DESKTOP=$(echo "${XDG_DATA_DIRS}" | sed 's/.*\(xfce\|kde\|gnome\).*/\1/')
else
    DESKTOP=${XDG_CURRENT_DESKTOP}
fi

# convert to lower case shell safe
DESKTOP=`echo "$DESKTOP" | tr '[:upper:]' '[:lower:]'`

#####################
# profile migration #
#####################

# First try the default case for migration, there is only a folder
# ${ID_PROFILE_FOLDER} and we can migrate this.
if [ -d "${ID_PROFILE_FOLDER}" -o -L "${ID_PROFILE_FOLDER}" ] && \
   [ ! -d "${TB_PROFILE_FOLDER}" -a ! -L "${TB_PROFILE_FOLDER}" ]; then
    debug "found folder '${ID_PROFILE_FOLDER}'"
    debug "not found folder '${TB_PROFILE_FOLDER}'"
    debug "Start Thunderbird profile migration, please be patient!"
    cp -a ${ID_PROFILE_FOLDER} ${TB_PROFILE_FOLDER}
    if [ "$(echo $?)" != 0  ]; then
        echo "A error happen while copying the Icedove profile folder into '${TB_PROFILE_FOLDER}'"
        echo "The old unchanged profile(s) will still be found in '${ID_PROFILE_FOLDER}'."
        echo "Please check for potentially problems like low disk space or wrong access rights!"
        logger -i -p warning -s "$0: [profile migration] Couldn't copy '${ID_PROFILE_FOLDER}' into '${TB_PROFILE_FOLDER}'!"
        FAIL=1
    fi
    mv ${ID_PROFILE_FOLDER} ${HOME}/.icedove_moved_by_thunderbird_starter
    debug "Migration done."
    debug "The old Icedove profile folder was moved to '${HOME}/.icedove_moved_by_thunderbird_starter'"

# We found both profile folder, the user has probaly a old or otherwise used
# Thunderbird installation.
elif [ -d "${ID_PROFILE_FOLDER}" -o -L "${ID_PROFILE_FOLDER}" ] && \
     [ -d "${TB_PROFILE_FOLDER}" -o -L "${TB_PROFILE_FOLDER}" ]; then
    debug "There is already a folder '${TB_PROFILE_FOLDER}', will do nothing."
    debug "Please investigate by yourself!"
    logger -i -p warning -s "$0: [profile migration] Couldn't migrate Icedove into Thunderbird profile due existing folder '${TB_PROFILE_FOLDER}'!"

    # display a graphical advice if possible
    case "${DESKTOP}" in
        gnome|GNOME|xfce|XFCE)
            zenity --info --no-wrap --title "${TITLE}" --text "${DOT_THUNDERBIRD_EXISTS}"
            FAIL=1
        ;;

        kde|KDE)
            kdialog --title "${TITLE}" --msgbox "${DOT_THUNDERBIRD_EXISTS}"
            FAIL=1
        ;;

        *)
            xmessage -center "${DOT_THUNDERBIRD_EXISTS}"
            FAIL=1
    esac
fi

if [ "$FAIL" = 1 ]; then
    echo "A error happen while trying to migrate the old Icedove profile folder '${ID_PROFILE_FOLDER}'."
    echo "Please take a look into the syslog file!"
    exit 1
fi

# There is no old Icedove profile folder (anymore), we have nothing to
# migrate, going further by starting Thunderbird.

if [ "${DEBUG}" = "" ]; then
    debug "call $MOZ_LIBDIR/$MOZ_APP_NAME '${THUNDERBIRD_OPTIONS}'"
    $MOZ_LIBDIR/$MOZ_APP_NAME "${THUNDERBIRD_OPTIONS}"
else
    # User has selected GDB?
    if [ "$DEBUGGER" = "1" ]; then
        # checking for GDB
        if [ -f /usr/bin/gdb ]; then
            if [ -f /usr/lib/debug/usr/lib/thunderbird/thunderbird ]; then
                echo "Starting Thunderbird with GDB ..."
                LANG= /usr/lib/thunderbird/run-mozilla.sh -g /usr/lib/thunderbird/thunderbird-bin "${THUNDERBIRD_OPTIONS}"
            else
                echo "No package 'thunderbird-dbg' installed! Please install first and restart."
                exit 1
            fi
        else
            echo "No package 'gdb' installed! Please install first and try again."
            exit 1
        fi
    fi
fi

exit 0
