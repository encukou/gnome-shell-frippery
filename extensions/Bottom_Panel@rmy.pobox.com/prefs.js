// Copyright (C) 2015-2023 R M Yorston
// Licence: GPLv2+

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _f} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const OVERRIDES_SCHEMA = 'org.gnome.mutter';
const WM_SCHEMA = 'org.gnome.desktop.wm.preferences';

const SETTINGS_NUM_ROWS = 'num-rows';
const SETTINGS_ENABLE_PANEL = 'enable-panel';
const SETTINGS_SHOW_PANEL = 'show-panel';
const SETTINGS_DYNAMIC_WORKSPACES = 'dynamic-workspaces';
const SETTINGS_NUM_WORKSPACES = 'num-workspaces';

class BottomPanelSettingsWidget extends Adw.PreferencesGroup {
    static {
        GObject.registerClass(this);
    }

    constructor(settings) {
        super();

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

        // preferences come from all over the place
        this.settings = settings;
        this.or_settings = new Gio.Settings({ schema: OVERRIDES_SCHEMA });
        this.wm_settings = new Gio.Settings({ schema: WM_SCHEMA });

        // number of workspaces (from window manager preferences)
        grid0.attach(new Gtk.Label({ label: _f('Number of Workspaces'),
                                    halign: Gtk.Align.END }), 0, 0, 1, 1);
        let adjustment = new Gtk.Adjustment({ lower: 1, upper: 32,
                                    step_increment: 1 });
        let spin = new Gtk.SpinButton({ adjustment: adjustment,
                        snap_to_ticks: true });
        let n_workspaces = this.wm_settings.get_int(SETTINGS_NUM_WORKSPACES);
        spin.set_value(n_workspaces);
        grid0.attach(spin, 1, 0, 1, 1);
        spin.connect('value-changed', (widget) => {
            this.wm_settings.set_int(SETTINGS_NUM_WORKSPACES, widget.get_value());
        });

        // number of rows (from bottom panel preferences)
        let nrows = this.settings.get_int(SETTINGS_NUM_ROWS);
        grid0.attach(new Gtk.Label({ label: _f('Rows in workspace switcher'),
                                    halign: Gtk.Align.END }), 0, 1, 1, 1);
        adjustment = new Gtk.Adjustment({ lower: 1, upper: 5,
                                    step_increment: 1 });
        spin = new Gtk.SpinButton({ adjustment: adjustment,
                        snap_to_ticks: true });
        spin.set_value(nrows);
        grid0.attach(spin, 1, 1, 1, 1);
        spin.connect('value-changed', (widget) => {
            this.settings.set_int(SETTINGS_NUM_ROWS, widget.get_value());
        });

        // dynamic workspaces (from shell overrides)
        let check = new Gtk.CheckButton({ label: _f('Dynamic workspaces'),
                                    margin_top: 6 });
        this.or_settings.bind(SETTINGS_DYNAMIC_WORKSPACES, check, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        grid0.attach(check, 0, 2, 2, 1);

        // enable panel (from bottom panel preferences)
        let enable = new Gtk.CheckButton({ label: _f('Enable panel'),
                                    margin_top: 6 });
        let enable_panel = this.settings.get_boolean(SETTINGS_ENABLE_PANEL);
        enable.set_active(enable_panel);
        enable.connect('toggled', this._enablePanel.bind(this));
        grid0.attach(enable, 0, 3, 2, 1);

        // show panel (from bottom panel preferences)
        let label = new Gtk.Label({ label: _f('Panel visible in workspace'),
                                 margin_bottom: 6, margin_top: 6,
                                 halign: Gtk.Align.START });
        grid0.attach(label, 0, 4, 2, 1);

        let grid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                  halign: Gtk.Align.CENTER,
                                  row_spacing: 6,
                                  column_spacing: 6 });
        grid0.attach(grid, 0, 5, 2, 1);

        let show_panel = this.settings.get_value(SETTINGS_SHOW_PANEL).deep_unpack();
        if ( show_panel.length < n_workspaces ) {
            for ( let i=show_panel.length; i<n_workspaces; ++i ) {
                show_panel[i] = true;
            }
        }

        let ncols = Math.floor(n_workspaces/nrows);
        if ( n_workspaces%nrows != 0 ) {
            ++ncols;
        }

        this.check = [];
        for ( let r=0; r<nrows; ++r ) {
            for ( let c=0; c<ncols; ++c ) {
                let i = r*ncols + c;
                if ( i < n_workspaces ) {
                    this.check[i] = new Gtk.CheckButton();
                    this.check[i].set_active(show_panel[i]);
                    grid.attach(this.check[i], c, r, 1, 1);
                    this.check[i].connect('toggled',
                            this._updatePanel.bind(this));
                }
            }
        }
    }

    _enablePanel(widget) {
        let enabled = widget.get_active();
        this.settings.set_boolean(SETTINGS_ENABLE_PANEL, enabled);

        for ( let i=0; i<this.check.length; ++i ) {
            this.check[i].set_sensitive(enabled);
        }
    }

    _updatePanel(widget) {
        let show_panel = [];
        for ( let i=0; i<this.check.length; ++i ) {
            show_panel[i] = this.check[i].get_active();
        }

        let value = GLib.Variant.new('ab', show_panel);
        this.settings.set_value(SETTINGS_SHOW_PANEL, value);
    }
}

export default class BottomPanelPreferences extends ExtensionPreferences {
    getPreferencesWidget() {
        return new BottomPanelSettingsWidget(this.getSettings());
    }
}
