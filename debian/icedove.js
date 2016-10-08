// This is the Debian specific preferences file for Mozilla Thunderbird
// You can make any change in here, it is the purpose of this file.
// You can, with this file and all files present in the directory
//
//      /etc/icedove/pref directory
//
// override any preference that is present in the directory
//
//      /usr/lib/icedove/defaults/pref
//
// While your changes will be kept on upgrade if you modify files in
// /etc/icedove/pref, please note that they won't be kept if you
// do them in /usr/lib/icedove/defaults/pref.

pref("extensions.update.enabled", true);

// Use LANG environment variable to choose locale
pref("intl.locale.matchOS", true);

// Disable default mail checking (gnome).
pref("mail.shell.checkDefaultMail", false);

// Disable default mail client check
pref("mail.shell.checkDefaultClient", false);

// if you are not using gnome
pref("network.protocol-handler.app.http", "x-www-browser");
pref("network.protocol-handler.app.https", "x-www-browser");

// This setting is a workaround for some crashes inside the JS engine.
// By this Icedove will use more memory and acting slower as the sharing
// memory between interacting JS files is disabled.
pref ("javascript.options.baselinejit", false);

