/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

/**
 * Global Object to hold methods for the alarms pref pane
 */
var gAlarmsPane = {
    /**
     * Initialize the alarms pref pane. Sets up dialog controls to match the
     * values set in prefs.
     */
    init: function gAP_init() {
        // Enable/disable the alarm sound URL box and buttons
        this.alarmsPlaySoundPrefChanged();

        // Set the correct singular/plural for the time units
        updateMenuLabelsPlural("eventdefalarmlen", "eventdefalarmunit");
        updateMenuLabelsPlural("tododefalarmlen",  "tododefalarmunit");
        updateUnitLabelPlural("defaultsnoozelength", "defaultsnoozelengthunit", "minutes");
    },

    /**
     * Converts the given file url to a nsILocalFile
     *
     * @param aFileURL    A string with a file:// url.
     * @return            The corresponding nsILocalFile.
     */
    convertURLToLocalFile: function gAP_convertURLToLocalFile(aFileURL) {
        // Convert the file url into a nsILocalFile
        if (aFileURL) {
            var fph = Services.io
                         .getProtocolHandler("file")
                         .QueryInterface(Components.interfaces.nsIFileProtocolHandler);
            return fph.getFileFromURLSpec(aFileURL);
        } else {
            return null;
        }
    },

    /**
     * Handler function to be called when the calendar.alarms.soundURL pref has
     * changed. Updates the label in the dialog.
     */
    readSoundLocation: function gAP_readSoundLocation() {
        var soundUrl = document.getElementById("alarmSoundFileField");
        soundUrl.value = document.getElementById("calendar.alarms.soundURL").value;
        if (soundUrl.value.startsWith("file://")) {
            soundUrl.label = this.convertURLToLocalFile(soundUrl.value).leafName;
        } else {
            soundUrl.label = soundUrl.value;
        }
        soundUrl.image = "moz-icon://" + soundUrl.label + "?size=16";
        return undefined;
    },

    /**
     * Causes the default sound to be selected in the dialog controls
     */
    useDefaultSound: function gAP_useDefaultSound() {
        var defaultSoundUrl = "chrome://calendar/content/sound.wav";
        document.getElementById("calendar.alarms.soundURL").value = defaultSoundUrl;
        document.getElementById("alarmSoundCheckbox").checked = true;
        this.readSoundLocation();
    },

    /**
     * Opens a filepicker to open a local sound for the alarm.
     */
    browseAlarm: function gAP_browseAlarm() {
        const nsIFilePicker = Components.interfaces.nsIFilePicker;
        var fp = Components.classes["@mozilla.org/filepicker;1"]
                    .createInstance(nsIFilePicker);

        var bundlePreferences = document.getElementById("bundleCalendarPreferences");
        var title = bundlePreferences.getString("Open");
        var wildmat = "*.wav";
        var label = bundlePreferences.getFormattedString("filterWav", [wildmat], 1);

        fp.init(window, title, nsIFilePicker.modeOpen);
        fp.appendFilter(label, wildmat);
        fp.appendFilters(nsIFilePicker.filterAll);

        var ret = fp.show();

        if (ret == nsIFilePicker.returnOK) {
            document.getElementById("calendar.alarms.soundURL").value = fp.fileURL.spec;
            document.getElementById("alarmSoundCheckbox").checked = true;
            this.readSoundLocation();
        }
    },

    /**
     * Plays the alarm sound currently selected.
     */
    previewAlarm: function gAP_previewAlarm() {
        var soundUrl = document.getElementById("alarmSoundFileField").value;
        var soundIfc = Components.classes["@mozilla.org/sound;1"]
                            .createInstance(Components.interfaces.nsISound);
        var url;
        try {
            soundIfc.init();
            if (soundUrl && soundUrl.length && soundUrl.length > 0) {
                url = Services.io.newURI(soundUrl, null, null);
                soundIfc.play(url);
            } else {
                soundIfc.beep();
            }
        } catch (ex) {
            dump("alarms.js previewAlarm Exception caught! " + ex + "\n");
        }
    },

    /**
     * Handler function to call when the calendar.alarms.playsound preference
     * has been changed. Updates the disabled state of fields that depend on
     * playing a sound.
     */
    alarmsPlaySoundPrefChanged: function gAP_alarmsPlaySoundPrefChanged() {
        var alarmsPlaySoundPref =
            document.getElementById("calendar.alarms.playsound");

        var items = [document.getElementById("alarmSoundFileField"),
                     document.getElementById("calendar.prefs.alarm.sound.useDefault"),
                     document.getElementById("calendar.prefs.alarm.sound.browse"),
                     document.getElementById("calendar.prefs.alarm.sound.play")];

        for (var i=0; i < items.length; i++) {
            items[i].disabled = !alarmsPlaySoundPref.value;
        }
    }
};
