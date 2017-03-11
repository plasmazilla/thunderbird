#!/bin/bash
# vim: autoindent tabstop=4 shiftwidth=4 expandtab softtabstop=4 filetype=sh textwidth=76
#
# File:
#   /usr/bin/thunderbird
#
# Purpose:
#   This is a wrapper script for starting the thunderbird binary with taking
#   care of the searching for an old user Icedove profile folder and adopting
#   the folder into the new place if possible.
#
# Environment:
#   The Icedove binary was using the profile folder '${HOME}/.icedove'. The
#   Mozilla default for the Thunderbird binary is '${HOME}/.thunderbird'.
#   The script will looking for the old profile folder and will symlink the
#   folder '${HOME}/.thunderbird' to the profile folder '${HOME}/.icedove'.
#
# Copyright:
#   Licensed under the terms of GPLv2+.

#set -x

TB_HELPER="/usr/lib/thunderbird/thunderbird-wrapper-helper.sh"
# sourcing external variables and helper functions
if [ -f "${TB_HELPER}" ]; then
    # hide the sourcing for http://www.shellcheck.net/
    # shellcheck source=/dev/null
    . "${TB_HELPER}"
else
    # this needs improving, the user isn't normally seeing this error!
    echo "helper ${TB_HELPER} not found!"
    exit 1
fi

# some global variables
MOZ_APP_NAME=thunderbird
MOZ_APP_LAUNCHER=$(which "$0")
MOZ_LIBDIR=/usr/lib/${MOZ_APP_NAME}
ID_PROFILE_FOLDER=${HOME}/.icedove
TB_PROFILE_FOLDER=${HOME}/.thunderbird

export HELP=0
export FAIL=0
export FORCE_MIMEAPPS_MIGRATE=0
export VERBOSE=0

# set MOZ_APP_LAUNCHER for gnome-session
export MOZ_APP_LAUNCHER

TB_ARGS=''

for ARG in "$@"; do
    case "${ARG}" in
        --fixmime)
            FIXMIME=1
            FORCE_MIMEAPPS_MIGRATE=1
            ;;
        -g)
            DEBUGGER=1
            DEBUG=1
            ;;
#       -d)
#            USER_DEBUGGER=$2
#            DEBUG=1
#            shift
#            ;;
        --help)
            HELP=1
            ;;
        --show-backup)
            SHOW_BACKUP=1
            ;;
        --verbose)
            output_info "[[ ... using verbose mode ... ]]"
            VERBOSE=1
            ;;
        '?')
            usage >&2
            exit 1
            ;;
        # Every other argument is needed to get down to the TB starting call.
        # For sanity we check if a argument has spaces, a equal sign or commas
        # and add then extra apostrophes around the argument. Escaping
        # characters given by the user are "eaten" previously by the Bash.
        *)
            # The argument has special characters, we add some extra
            # apostrophes around. Triggering the following signs:
            # space ' '
            # comma ','
            # equal sign '='
            if [[ "${ARG}" =~ ([[:space:]]|[(,|=)]) ]]; then
                TB_ARGS="${TB_ARGS} \"${ARG}\""
            else
                # No special handling needed.
                TB_ARGS="${TB_ARGS} ${ARG}"
            fi
            ;;
    esac
    shift
done

# sanity check
if [ "$DEBUGGER" != "" ] && [ "$USER_DEBUGGER" != "" ]; then
    output_info "You can't use option '-g and '-d' at the same time!"
    usage
    exit 1
fi

# If '--help' was called show usage() and exit immediately without other
# helpers can be called.
if [ "${HELP}" = "1" ]; then
    usage
    exit 0
fi

# The user is forcing to do the MIME fixing (again). If called a used
# profile(s) folder ~/.thunderbird will be also reworked. That's not the
# case if the user is starting this wrapper for a first time and only a
# folder ~/.thunderbird is existing!
if [ "${FIXMIME}" = "1" ]; then
    do_fix_mimetypes_rdf
    do_migrate_old_icedove_desktop
    do_collect_backup_files
    exit 0
fi

if [ "${SHOW_BACKUP}" = "1" ]; then
    do_collect_backup_files
    exit 0
fi

#############################################################################
#                  User Thunderbird Profile Adoptions                       #
#                                                                           #
# The users Icedove/Thunderbird profile(s) doesn't need to be modified in a #
# different and complicated way. We simply need to ensure that the          #
# Thunderbird binary is finding the existing profiles in the folder         #
# $(HOME)/.thunderbird folder or a valid symlink pointing to the profiles.  #
#                                                                           #
# To "migrate" an old existing Icedove profile we can simply do a symlink   #
# from $(HOME)/.thunderbird --> $(HOME)/.icedove .                          #
#                                                                           #
# Afterwards do some changes to the file mimeTypes.rdf within every         #
# profile. Also we can modify existing *icedove*.desktop entries in the     #
# files.                                                                    #
#                                                                           #
#     $(HOME)/.config/mimeapps.list                                         #
#     $(HOME)/.local/share/applications/mimeapps.list                       #
#                                                                           #
#############################################################################

# First try the default case for modification, there is only a folder
# ${ID_PROFILE_FOLDER} and we can symlink to this.
if { [ -d "${ID_PROFILE_FOLDER}" ] || [ -L "${ID_PROFILE_FOLDER}" ]; } && \
   { [ ! -d "${TB_PROFILE_FOLDER}" ] && [ ! -L "${TB_PROFILE_FOLDER}" ]; }; then
    output_debug "found folder '${ID_PROFILE_FOLDER}'"
    output_debug "not found folder or symlink '${TB_PROFILE_FOLDER}'"
    output_debug "Start Thunderbird profile adoptions, please be patient!"

    # open a pop-up window with a message about starting migration
    do_inform_migration_start

    # do the symlinking
    do_thunderbird2icedove_symlink

    # fixing mimeTypes.rdf which may have registered the iceweasel binary
    # as browser, instead of x-www-browser
    do_fix_mimetypes_rdf

    # Fix local mimeapp.list and *.desktop entries
    do_migrate_old_icedove_desktop

    # we are finished
    output_info "Thunderbird Profile adoptions done."
    do_collect_backup_files
fi

# We found both profile folder, and .thunderbird is a symlink,
# we need to check if .thunderbird is symlinked to .icedove
if { [ -d "${ID_PROFILE_FOLDER}" ] && [ -L "${TB_PROFILE_FOLDER}" ]; } && \
   [ "$(readlink -e "${TB_PROFILE_FOLDER}")" = "${ID_PROFILE_FOLDER}" ];then

    output_debug "Found folder ${ID_PROFILE_FOLDER}, found a symlink ${TB_PROFILE_FOLDER} pointing to ${ID_PROFILE_FOLDER}"

    # Check if we need to do some migration, the linking could be existing
    # before we switched back to Thunderbird.
    if [ ! -f "${TB_PROFILE_FOLDER}/.migrated" ]; then
        # Fixing mimeTypes.rdf which may have registered the iceweasel binary
        # as browser, instead of x-www-browser
        do_fix_mimetypes_rdf

        # Fix local mimeapp.list and *.desktop entries
        do_migrate_old_icedove_desktop
    fi

# ... or the opposite if .icedove is symlinked to .thunderbird
elif { [ -d "${TB_PROFILE_FOLDER}" ] && [ -L "${ID_PROFILE_FOLDER}" ]; } && \
     [ "$(readlink -e "${ID_PROFILE_FOLDER}")" = "${TB_PROFILE_FOLDER}" ];then

    output_debug "Found folder ${TB_PROFILE_FOLDER}, found a symlink ${ID_PROFILE_FOLDER} pointing to ${TB_PROFILE_FOLDER}"
    output_debug "You may want to remove the symlink ${ID_PROFILE_FOLDER}? It's probably not needed anymore."

    # Check if we need to do some migration ...
    if [ ! -f "${TB_PROFILE_FOLDER}/.migrated" ]; then
        # Fixing mimeTypes.rdf which may have registered the iceweasel binary
        # as browser, instead of x-www-browser
        do_fix_mimetypes_rdf

        # Fix local mimeapps.list and *.desktop entries
        do_migrate_old_icedove_desktop
    fi

# We found both profile folder, but they are not linked to each other! This
# is a state we can't solve on our own !!! The user needs to interact and
# has probably an old or otherwise used Thunderbird installation. Which one
# is the correct one to use?
elif { [ -d "${ID_PROFILE_FOLDER}" ] || [ -L "${ID_PROFILE_FOLDER}" ]; } && \
     { [ -d "${TB_PROFILE_FOLDER}" ] || [ -L "${TB_PROFILE_FOLDER}" ]; } && \
       [ "$(readlink -e "${TB_PROFILE_FOLDER}")" != "${ID_PROFILE_FOLDER}" ]; then

    for CHECK in ${ID_PROFILE_FOLDER} ${TB_PROFILE_FOLDER}; do
        FILE_CHECK=$(readlink -e "${CHECK}")
        if [ "${FILE_CHECK}" != "" ] && [ -L "${CHECK}" ]; then
            output_debug "Found symlink '${CHECK}' pointing to '${FILE_CHECK}'."
        elif [ "${FILE_CHECK}" != "" ] && [ -d "${CHECK}" ]; then
            output_debug "Found folder '${FILE_CHECK}'."
        else
            output_debug "${CHECK} is probably a symlink pointing to a non existing target, at least not to ${ID_PROFILE_FOLDER}."
            logger -i -p warning -s "$0: [profile migration] ${CHECK} is probably a symlink pointing to a non existing target, at least not to ${ID_PROFILE_FOLDER}."
        fi
    done

    output_debug "There are already the folders or symlinks '${TB_PROFILE_FOLDER}' and '${ID_PROFILE_FOLDER}'"
    output_debug "which not pointing to each other, will do nothing as don't know which folder to use."
    output_debug "Please investigate by yourself! Maybe you will find additional information in '/usr/share/doc/thunderbird/README.Debian.gz'."
    logger -i -p warning -s "$0: [profile migration] Couldn't migrate Icedove into Thunderbird profile due existing or symlinked folder '${TB_PROFILE_FOLDER}'!"

    # display a graphical advice if possible
    do_thunderbird2icedove_error_out

fi

if [ "${FAIL}" = 1 ]; then
    output_info "An error happened while trying to migrate the old Icedove profile folder '${ID_PROFILE_FOLDER}'."
    output_info "Please take a look into the syslog file!"
    exit 1
fi

# If we are here we going simply further by starting Thunderbird.

if [ "${DEBUG}" = "" ]; then
    output_debug "call '${MOZ_LIBDIR}/${MOZ_APP_NAME} ${TB_ARGS}'"
    eval "${MOZ_LIBDIR}"/"${MOZ_APP_NAME}" "${TB_ARGS}"
else
    # User has selected GDB?
    if [ "${DEBUGGER}" = "1" ]; then
        # checking for GDB
        if [ -f /usr/bin/gdb ]; then
            if [ -f /usr/lib/debug/usr/lib/thunderbird/thunderbird ]; then
                output_info "Starting Thunderbird with GDB ..."
                eval LANG='' "${MOZ_LIBDIR}"/run-mozilla.sh -g "${MOZ_LIBDIR}"/"${MOZ_APP_NAME}" "${TB_ARGS}"
            else
                output_info "No package 'thunderbird-dbg' installed! Please install first and restart."
                exit 1
            fi
        else
            output_info "No package 'gdb' installed! Please install first and try again."
            exit 1
        fi
    fi
fi

exit 0
