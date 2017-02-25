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

#set -x

TB_HELPER="/usr/lib/thunderbird/thunderbird-wrapper-helper.sh"
# sourcing external variables and helper functions
if [ -f ${TB_HELPER} ]; then
    . ${TB_HELPER}
else
    # this needs improving, the user isn't seen this error!
    echo "helper ${TB_HELPER} not found!"
    exit 1
fi

# some global variables
MOZ_APP_NAME=thunderbird
MOZ_APP_LAUNCHER=`which $0`
MOZ_LIBDIR=/usr/lib/${MOZ_APP_NAME}
ID_PROFILE_FOLDER=${HOME}/.icedove
TB_PROFILE_FOLDER=${HOME}/.thunderbird

# set MOZ_APP_LAUNCHER for gnome-session
export MOZ_APP_LAUNCHER

TB_ARGS=""
while [ $# -gt 0 ]; do
    ARG="$1"
    case ${ARG} in
        --help) HELP=1
            usage
            exit 0
            ;;
        --verbose) echo "[[ ... using verbose mode ... ]]"
            VERBOSE=1
            ;;
        -g)
            DEBUGGER=1
            DEBUG=1
            ;;
#        d)
#            USER_DEBUGGER=$2
#            DEBUG=1
#            ;;
        '?')
            usage >&2
            exit 1
            ;;
        # every other argument is needed to get down to the TB starting call
        *) TB_ARGS="${TB_ARGS} ${ARG}"
        ;;
    esac
    shift
done

# sanity check
if [ "$DEBUGGER" != "" ] && [ "$USER_DEBUGGER" != "" ]; then
    echo "You can't use option '-g and '-d' at the same time!"
    usage
    exit 1
fi

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

    # open a pop-up window with a message about starting migration
    inform_migration_start

    cp -a ${ID_PROFILE_FOLDER} ${TB_PROFILE_FOLDER}
    if [ "$(echo $?)" != 0  ]; then
        echo "A error happened while copying the Icedove profile folder into '${TB_PROFILE_FOLDER}'"
        echo "The old unchanged profile(s) will still be found in '${ID_PROFILE_FOLDER}'."
        echo "Please check for potentially problems like low disk space or wrong access rights!"
        logger -i -p warning -s "$0: [profile migration] Couldn't copy '${ID_PROFILE_FOLDER}' into '${TB_PROFILE_FOLDER}'!"
        FAIL=1
    fi
    mv ${ID_PROFILE_FOLDER} ${HOME}/.icedove_moved_by_thunderbird_starter

    # only move on if we not have already a problem
    if [ "${FAIL}" != 1 ]; then
        # Fixing mimeTypes.rdf which may have registered the iceweasel binary
        # as browser, instead of x-www-browser
        debug "Fixing possible broken 'mimeTypes.rdf'."
        for MIME_TYPES_RDF_FILE in $(find ${TB_PROFILE_FOLDER}/ -name mimeTypes.rdf); do
            sed -i "s|/usr/bin/iceweasel|/usr/bin/x-www-browser|g" "${MIME_TYPES_RDF_FILE}"
        done
        debug "Migration done."
        debug "The old Icedove profile folder was moved to '${HOME}/.icedove_moved_by_thunderbird_starter'"
    fi

# We found both profile folder, the user has probably a old or otherwise used
# Thunderbird installation.
elif [ -d "${ID_PROFILE_FOLDER}" -o -L "${ID_PROFILE_FOLDER}" ] && \
     [ -d "${TB_PROFILE_FOLDER}" -o -L "${TB_PROFILE_FOLDER}" ]; then
    debug "There is already a folder '${TB_PROFILE_FOLDER}', will do nothing."
    debug "Please investigate by yourself!"
    logger -i -p warning -s "$0: [profile migration] Couldn't migrate Icedove into Thunderbird profile due existing folder '${TB_PROFILE_FOLDER}'!"

    # display a graphical advice if possible
    case "${DESKTOP}" in
        gnome|mate|xfce)
            local_zenity --info --no-wrap --title "${TITLE}" --text "${DOT_THUNDERBIRD_EXISTS}"
            if [ $? -ne 0 ]; then
                local_xmessage -center "${DOT_THUNDERBIRD_EXISTS}"
            fi
            FAIL=1
            ;;

        kde)
            local_kdialog --title "${TITLE}" --msgbox "${DOT_THUNDERBIRD_EXISTS}"
            if [ $? -ne 0 ]; then
                local_xmessage -center "${DOT_THUNDERBIRD_EXISTS}"
            fi
            FAIL=1
            ;;

        *)
            xmessage -center "${DOT_THUNDERBIRD_EXISTS}"
            FAIL=1
            ;;
    esac
fi

if [ "$FAIL" = 1 ]; then
    echo "A error happened while trying to migrate the old Icedove profile folder '${ID_PROFILE_FOLDER}'."
    echo "Please take a look into the syslog file!"
    exit 1
fi

# Fix local mimeapp.list and *.desktop entries
migrate_old_icedove_desktop

# There is no old Icedove profile folder (anymore), we have nothing to
# migrate, going further by starting Thunderbird.

if [ "${DEBUG}" = "" ]; then
    debug "call '$MOZ_LIBDIR/$MOZ_APP_NAME ${TB_ARGS}'"
    $MOZ_LIBDIR/$MOZ_APP_NAME ${TB_ARGS}
else
    # User has selected GDB?
    if [ "$DEBUGGER" = "1" ]; then
        # checking for GDB
        if [ -f /usr/bin/gdb ]; then
            if [ -f /usr/lib/debug/usr/lib/thunderbird/thunderbird ]; then
                echo "Starting Thunderbird with GDB ..."
                LANG= /usr/lib/thunderbird/run-mozilla.sh -g /usr/lib/thunderbird/thunderbird-bin "${TB_ARGS}"
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
