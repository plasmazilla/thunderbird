#!/bin/sh
# vim: autoindent tabstop=4 shiftwidth=4 expandtab softtabstop=4 filetype=sh textwidth=76
#
# File:
#   /usr/lib/thunderbird/thunderbird-wrapper-helper.sh
#
# Purpose:
#   This shell script is holding some additional helper functions and
#   variables that are used or called from the main wrapper-script in
#   /usr/bin/thunderbird.
#
# Copyright:
#   Licensed under the terms of GPLv2+.


# trying to get the DE
if [ "${XDG_CURRENT_DESKTOP}" = "" ]; then
    DESKTOP=$(echo "${XDG_DATA_DIRS}" | sed 's/.*\(gnome\|kde\|mate\|xfce\).*/\1/')
else
    DESKTOP=${XDG_CURRENT_DESKTOP}
fi

# convert to lower case shell safe
DESKTOP=`echo "$DESKTOP" | tr '[:upper:]' '[:lower:]'`

#########################################
# message templates for the X11 dialogs #
#########################################

DEFAULT_X11_MSG="\
If you see this message box something went wrong while
migrating your Icedove profile(s) into the Thunderbird
profile folder!

The following error happened:"

DOT_THUNDERBIRD_EXISTS="\
${DEFAULT_X11_MSG}

An existing profile folder '.thunderbird' was found in your Home
directory '${HOME}/' while trying to migrate the Icedove
profile(s) folder!

This can probably be a old, currently not used profile folder or
you maybe using a Thunderbird installation from the Mozilla packages.
If you don't need this old profile folder, you can remove or backup
it and start Thunderbird again.

Sorry, but please investigate the situation by yourself.

Please mind also the information in section 'Profile Migration'
given in the file

/usr/share/doc/thunderbird/README.Debian.gz
"

START_MIGRATION="\
You see this window because you're starting Thunderbird for the first time
with underlaying profile(s) from Icedove.
The Icedove package is now de-branded back to Thunderbird.

The Icedove profile(s) will now be migrated to the Thunderbird folder
structure. This will take some time!

Please be patient, the Thunderbird program will be started right after
the migration.

If you need more information about the de-branding of the Icedove package
please take a look into

/usr/share/doc/thunderbird/README.Debian.gz
"

TITLE="Icedove to Thunderbird Profile migration"

###################
# local functions #
###################

# Simple debugging function
debug () {
if [ "${VERBOSE}" = "1" ]; then
    echo "DEBUG -> $1"
fi
}

# Inform the user we will starting the migration
inform_migration_start () {
case "${DESKTOP}" in
    gnome|mate|xfce)
        local_zenity --info --no-wrap --title "${TITLE}" --text "${START_MIGRATION}"
        if [ $? -ne 0 ]; then
            local_xmessage -center "${START_MIGRATION}"
        fi
        ;;

    kde)
        local_kdialog --title "${TITLE}" --msgbox "${START_MIGRATION}"
        if [ $? -ne 0 ]; then
            local_xmessage -center "${START_MIGRATION}"
        fi
        ;;

    *)
        xmessage -center "${START_MIGRATION}"
        ;;
esac
}

# Wrapping /usr/bin/kdialog calls
local_kdialog () {
if [ -f /usr/bin/kdialog ]; then
    /usr/bin/kdialog "$@"
    return 0
else
    return 1
fi
}

# Wrapping /usr/bin/xmessage calls
local_xmessage () {
if [ -f /usr/bin/xmessage ]; then
    /usr/bin/xmessage "$@"
else
    # this should never be reached as thunderbird has a dependency on x11-utils!
    echo "xmessage not found"
fi
}

# Wrapping /usr/bin/zenity calls
local_zenity () {
if [ -f /usr/bin/zenity ]; then
    /usr/bin/zenity "$@"
    return 0
else
    return 1
fi
}

# Function that will do the complete profile migration
migrate_old_icedove_desktop() {
# Fixing mimeapps.list files in ~/.config/ and ~/.local ... which may have
# icedove.desktop associations, the latter location is deprecated, but still
# commonly used.
# These mimeapps.list files configures default applications for MIME types.
for MIMEAPPS_LIST in ${HOME}/.config/mimeapps.list ${HOME}/.local/share/applications/mimeapps.list; do
    # Check if file exists and has old icedove entry
    if [ -e "${MIMEAPPS_LIST}" ] && \
          grep -iq "\(userapp-\)*icedove\(-.*\)*\.desktop" "${MIMEAPPS_LIST}"; then
        debug "Fixing broken '${MIMEAPPS_LIST}'."
        MIMEAPPS_LIST_COPY="${MIMEAPPS_LIST}.copy_by_thunderbird_starter"
        if [ -e ${MIMEAPPS_LIST_COPY} ]; then
            echo "The configuration file for default applications for some MIME types"
            echo "'${MIMEAPPS_LIST}' already has a backup file '${MIMEAPPS_LIST_COPY}'."
            echo "Moving old copy to '${MIMEAPPS_LIST_COPY}-old'!"
            mv ${MIMEAPPS_LIST_COPY} ${MIMEAPPS_LIST_COPY}-old
            logger -i -p warning -s "$0: [profile migration] Backup file '${MIMEAPPS_LIST_COPY}' of '${MIMEAPPS_LIST}' already exists, moving to '${MIMEAPPS_LIST_COPY}-old'!"
        fi
        # Fix mimeapps.list and create backup
        # (requires GNU sed 3.02 or ssed for case-insensitive "I")
        sed -i.copy_by_thunderbird_starter "s|\(userapp-\)*icedove\(-.*\)*\.desktop|thunderbird.desktop|gI" "${MIMEAPPS_LIST}"
        if [ $? -ne 0 ]; then
            echo "The configuration file for default applications for some MIME types"
            echo "'${MIMEAPPS_LIST}' couldn't be fixed."
            echo "Please check for potential problems like low disk space or wrong access rights!"
            logger -i -p warning -s "$0: [profile migration] Couldn't fix '${MIMEAPPS_LIST}'!"
            exit 1
        fi
    fi
    debug "A copy of the configuration file of default applications for some MIME types"
    debug "was saved into '${MIMEAPPS_LIST_COPY}'."
done

# Migrate old user specific desktop entries
# Users could have always been created own desktop shortcuts for Icedove in
# the past. These associations (files named like 'userapp-Icedove-*.desktop')
# are done in the folder $(HOME)/.local/share/applications/.

# Remove such old icedove.desktop files, superseded by system-wide
# /usr/share/applications/thunderbird.desktop. The old ones in $HOME don't
# receive updates and might have missing/outdated fields.
# *.desktop files and their reverse cache mimeinfo cache provide information
# about available applications.

for ICEDOVE_DESKTOP in $(find ${HOME}/.local/share/applications/ -iname "*icedove*.desktop"); do
    ICEDOVE_DESKTOP_COPY=${ICEDOVE_DESKTOP}.copy_by_thunderbird_starter
    mv ${ICEDOVE_DESKTOP} ${ICEDOVE_DESKTOP_COPY}
    # Update the mimeinfo cache.
    # Not existing *.desktop files in there should simply be ignored by the system anyway.
    if [ -x "$(which update-desktop-database)" ]; then
        update-desktop-database ${HOME}/.local/share/applications/
    fi
done
}

# Giving out a information how this script can be called
usage () {
cat << EOF

Usage: ${0##*/} [--help|? | --verbose | -g | \$thunderbird-arguments]

Options for this script and Thunderbird specific arguments can be mixed up.
Note that some Thunderbird options needs an additional argument that can't
be naturally mixed up with other options!

  --help or ? display this help and exit
  --verbose   verbose mode, increase the output messages to stdout
              (Logging to /var/log/syslog - if nessesary - isn't touched or
               increased by this option!)
  -g          starts Thunderbird within gdb (needs package thunderbird-dbg!)
EOF
#    -d      starts Thunderbird with specific debugger
cat << EOF

Examples:

 ${0##*/} --help

    Writes this help messages on stdout. If any other option is given it
    will be ignored. Note that Thunderbird also has a oprion '-h' which needs
    explictely given if want the help output for Thunderbird!

 ${0##*/} --verbose

    Enable some debug messages on stdout. Only useful while developing the
    thunderbird packages or while the profile migration to see some more
    messages on stdout.

 ${0##*/} -g

    Starts Thunderbird in a GDB session if packages gdb and thunderbird-dbg
    is installed.
EOF
# other debuggers will be added later, we need maybe a separate valgrind
# package! Note MDN site for valgrind
#    https://developer.mozilla.org/en-US/docs/Mozilla/Testing/Valgrind
# ${0##*/} -d gdb
#    The same as above, only manually specified the GDB debugging tool as
#    argument. Note that you probably will need additional parameter to
#    enable e.g. writing to a logfile.
#    It's also possible to specify valgrind, that will need to add additional
#    quoted arguments in any case!
#    The thunderbird binary must be compiled with valgrind support if you
#    want to use valgrind here!
#
#      ${0##*/} -d 'valgrind --arg1 --arg2' -thunderbird-arg1
cat << EOF

 ${0##*/} \$thunderbird-arguments

    Adding some thunderbird command line specific arguments, like e.g.
    calling the ProfileManager or safe-mode in case of trouble. Would look
    like this if you need to run in safe-mode with the JS Error console,
    that can be combined with the -g option:

      ${0##*/} --safe-mode --jsconsole

    Call Thunderbird directly to compose a message with a specific
    attachement.

      ${0##*/} -compose attachment=\$attachment

    Or to see the possible arguments for thunderbird that could be added
    here:

      ${0##*/} -h

EOF
}

# end local functions

