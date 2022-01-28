// Copyright (C) 2015-2023 R M Yorston
// Licence: GPLv2+

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _f} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SETTINGS_SHOW_ICON = "show-icon";
const SETTINGS_SHOW_TEXT = "show-text";

class ApplicationsMenuSettingsWidget extends Adw.PreferencesGroup {
    static {
        GObject.registerClass(this);
    }

    constructor(settings) {
        super();

        this.settings = settings;
        let grid0 = new Gtk.Grid({
            halign: Gtk.Align.CENTER,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
            column_spacing: 12,
            row_spacing: 6,
        });
        this.add(grid0);

        let check = new Gtk.CheckButton({ label: _f("Icon"), margin_top: 6 });
        this.settings.bind(SETTINGS_SHOW_ICON, check, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        grid0.attach(check, 0, 0, 1, 1);

        check = new Gtk.CheckButton({ label: _f("Text"), margin_top: 6 });
        this.settings.bind(SETTINGS_SHOW_TEXT, check, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        grid0.attach(check, 0, 1, 1, 1);
    }
}

export default class ApplicationsMenuPreferences extends ExtensionPreferences {
    getPreferencesWidget() {
        return new ApplicationsMenuSettingsWidget(this.getSettings());
    }
}
