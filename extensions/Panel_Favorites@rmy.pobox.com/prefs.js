// Copyright (C) 2015-2021 R M Yorston
// Licence: GPLv2+

/* stolen from the workspace-indicator extension */
const { Gio, GObject, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;

const _f = imports.gettext.domain('frippery-panel-favorites').gettext;

const SETTINGS_FAVORITES_ENABLED = 'favorites-enabled';
const SETTINGS_FAVORITES_POSITION = 'favorites-position';
const SETTINGS_OTHER_APPS_ENABLED = 'other-apps-enabled';
const SETTINGS_OTHER_APPS_POSITION = 'other-apps-position';
const SETTINGS_OTHER_APPS = 'other-apps';

const AppsModel = GObject.registerClass(
class AppsModel extends Gtk.ListStore {
    _init(params) {
        super._init(params);
        this.set_column_types([GObject.TYPE_STRING]);

        this.Columns = {
            LABEL: 0,
        };

        this._settings = ExtensionUtils.getSettings();

        this._reloadFromSettings();

        // overriding class closure doesn't work, because GtkTreeModel
        // plays tricks with marshallers and class closures
        this.connect('row-changed', this._onRowChanged.bind(this));
        this.connect('row-inserted', this._onRowInserted.bind(this));
        this.connect('row-deleted', this._onRowDeleted.bind(this));
    }

    _reloadFromSettings() {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let newNames = this._settings.get_strv(SETTINGS_OTHER_APPS);

        let i = 0;
        let [ok, iter] = this.get_iter_first();
        while (ok && i < newNames.length) {
            this.set(iter, [this.Columns.LABEL], [newNames[i]]);

            ok = this.iter_next(iter);
            i++;
        }

        while (ok)
            ok = this.remove(iter);

        for ( ; i < newNames.length; i++) {
            iter = this.append();
            this.set(iter, [this.Columns.LABEL], [newNames[i]]);
        }

        this._preventChanges = false;
    }

    _onRowChanged(self, path, iter) {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let index = path.get_indices()[0];
        let names = this._settings.get_strv(SETTINGS_OTHER_APPS);

        if (index >= names.length) {
            // fill with blanks
            for (let i = names.length; i <= index; i++)
                names[i] = '';
        }

        names[index] = this.get_value(iter, this.Columns.LABEL);

        this._settings.set_strv(SETTINGS_OTHER_APPS, names);

        this._preventChanges = false;
    }

    _onRowInserted(self, path, iter) {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let index = path.get_indices()[0];
        let names = this._settings.get_strv(SETTINGS_OTHER_APPS);
        let label = this.get_value(iter, this.Columns.LABEL) || '';
        names.splice(index, 0, label);

        this._settings.set_strv(SETTINGS_OTHER_APPS, names);

        this._preventChanges = false;
    }

    _onRowDeleted(self, path) {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let index = path.get_indices()[0];
        let names = this._settings.get_strv(SETTINGS_OTHER_APPS);

        if (index >= names.length)
            return;

        names.splice(index, 1);

        // compact the array
        for (let i = names.length -1; i >= 0 && !names[i]; i++)
            names.pop();

        this._settings.set_strv(SETTINGS_OTHER_APPS, names);

        this._preventChanges = false;
    }
});

const PanelFavoritesSettingsWidget = GObject.registerClass(
class PanelFavoritesSettingsWidget extends Gtk.Grid {
    _init(params) {
        super._init({
            halign: Gtk.Align.CENTER,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
            column_spacing: 12,
            row_spacing: 6,
        });

        this._settings = ExtensionUtils.getSettings();

        let label = new Gtk.Label({
                    label: '<b>' + _f("Favorites") + '</b>',
                    use_markup: true, margin_bottom: 6,
                    hexpand: true, halign: Gtk.Align.START });
        this.attach(label, 0, 0, 1, 1);

        let grid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                  margin_start: 12,
                                  row_spacing: 6,
                                  column_spacing: 6 });
        this.attach(grid, 0, 1, 1, 1);

        let state = this._settings.get_boolean(SETTINGS_FAVORITES_ENABLED);
        let check = new Gtk.CheckButton({ label: _f("Enable"),
                                          active: state,
                                          margin_top: 6 });
        this._settings.bind(SETTINGS_FAVORITES_ENABLED, check,                                             'active', Gio.SettingsBindFlags.DEFAULT);
        grid.attach(check, 0, 0, 1, 1);

        let box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                spacing: 6 });
        grid.attach(box, 0, 1, 1, 1);

        box.append(new Gtk.Label({ label: _f("Position"),
                                       halign: Gtk.Align.START }));

        state = this._settings.get_boolean(SETTINGS_FAVORITES_POSITION);
        let radio = null;
        radio = new Gtk.CheckButton({ active: !state,
                                      label: _f('Left'),
                                      group: radio });
        box.append(radio);

        radio = new Gtk.CheckButton({ active: state,
                                      label: _f('Right'),
                                      group: radio });
        this._settings.bind(SETTINGS_FAVORITES_POSITION, radio, 'active',
                            Gio.SettingsBindFlags.DEFAULT);
        radio.set_active(state);
        box.append(radio);


        label = new Gtk.Label({
                    label: '<b>' + _f("Other Applications") + '</b>',
                    use_markup: true, margin_bottom: 6, margin_top: 12,
                    hexpand: true, halign: Gtk.Align.START });
        this.attach(label, 0, 2, 1, 1);

        grid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                  margin_start: 12,
                                  row_spacing: 6,
                                  column_spacing: 6 });
        this.attach(grid, 0, 3, 1, 1);

        state = this._settings.get_boolean(SETTINGS_OTHER_APPS_ENABLED);
        check = new Gtk.CheckButton({ label: _f("Enable"),
                                      active: state,
                                      margin_top: 6 });
        this._settings.bind(SETTINGS_OTHER_APPS_ENABLED, check, 'active',
                            Gio.SettingsBindFlags.DEFAULT);
        grid.attach(check, 0, 0, 1, 1);

        box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                            spacing: 6 });
        grid.attach(box, 0, 1, 1, 1);

        box.append(new Gtk.Label({
                    label: _f("Position"),
                    halign: Gtk.Align.START }));

        state = this._settings.get_boolean(SETTINGS_OTHER_APPS_POSITION);
        radio = null;
        radio = new Gtk.CheckButton({ active: !state,
                                      label: _f('Left'),
                                      group: radio });
        box.append(radio);

        radio = new Gtk.CheckButton({ active: state,
                                      label: _f('Right'),
                                      group: radio });
        this._settings.bind(SETTINGS_OTHER_APPS_POSITION, radio, 'active',
                            Gio.SettingsBindFlags.DEFAULT);
        radio.set_active(state);
        box.append(radio);

        let scrolled = new Gtk.ScrolledWindow();
        scrolled.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        grid.attach(scrolled, 0, 2, 1, 1);

        this._store = new AppsModel();
        this._treeView = new Gtk.TreeView({ model: this._store,
                                            headers_visible: false,
                                            reorderable: true,
                                            hexpand: true,
                                            vexpand: true
                                          });

        let column = new Gtk.TreeViewColumn({ title: _f("Launcher") });
        let renderer = new Gtk.CellRendererText({ editable: true });
        renderer.connect('edited', this._cellEdited.bind(this));
        column.pack_start(renderer, true);
        column.add_attribute(renderer, 'text', this._store.Columns.LABEL);
        this._treeView.append_column(column);

        scrolled.set_child(this._treeView);

        let toolbar = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });

        let newButton = new Gtk.Button({ icon_name: 'list-add-symbolic' });
        newButton.connect('clicked', this._newClicked.bind(this));
        toolbar.append(newButton);

        let delButton = new Gtk.Button({ icon_name: 'list-remove-symbolic' });
        delButton.connect('clicked', this._delClicked.bind(this));
        toolbar.append(delButton);

        let selection = this._treeView.get_selection();
        selection.connect('changed',
            function() {
                delButton.sensitive = selection.count_selected_rows() > 0;
            });
        delButton.sensitive = selection.count_selected_rows() > 0;

        grid.attach(toolbar, 0, 3, 1, 1);
    }

    _cellEdited(renderer, path, new_text) {
        let [ok, iter] = this._store.get_iter_from_string(path);

        if (ok)
            this._store.set(iter, [this._store.Columns.LABEL], [new_text]);
    }

    _newClicked() {
        let iter = this._store.append();
        let index = this._store.get_path(iter).get_indices()[0];

        let label = "dummy.desktop";
        this._store.set(iter, [this._store.Columns.LABEL], [label]);
    }

    _delClicked() {
        let [any, model, iter] = this._treeView.get_selection().get_selected();

        if (any)
            this._store.remove(iter);
    }
});

function init() {
    ExtensionUtils.initTranslations();
}

function buildPrefsWidget() {
    return new PanelFavoritesSettingsWidget();
}
