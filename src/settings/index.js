'use strict';

// ============================================================================
// Settings System
// ============================================================================

import Module from 'utilities/module';
import {deep_equals, has} from 'utilities/object';

import {CloudStorageProvider, LocalStorageProvider} from './providers';
import SettingsProfile from './profile';
import SettingsContext from './context';
import MigrationManager from './migration';


// ============================================================================
// SettingsManager
// ============================================================================

/**
 * The SettingsManager module creates all the necessary class instances
 * required for the settings system to operate, facilitates communication
 * and discovery, and emits events for other modules to react to.
 * @extends Module
 */
export default class SettingsManager extends Module {
	/**
	 * Create a SettingsManager module.
	 */
	constructor(...args) {
		super(...args);

		// State
		this.__contexts = [];
		this.__profiles = [];
		this.__profile_ids = {};

		this.ui_structures = new Map;
		this.definitions = new Map;

		// Create our provider as early as possible.
		const provider = this.provider = this._createProvider();
		this.log.info(`Using Provider: ${provider.constructor.name}`);
		provider.on('changed', this._onProviderChange, this);


		this.migrations = new MigrationManager(this);


		// Also create the main context as early as possible.
		this.main_context = new SettingsContext(this);

		this.main_context.on('changed', (key, new_value, old_value) => {
			this.emit(`:changed:${key}`, new_value, old_value);
		});

		this.main_context.on('uses_changed', (key, new_uses, old_uses) => {
			this.emit(`:uses_changed:${key}`, new_uses, old_uses);
		});


		// Don't wait around to be required.
		this._start_time = performance.now();
		this.enable();
	}

	generateLog() {
		const out = [];
		for(const [key, value] of this.main_context.__cache.entries())
			out.push(`${key}: ${JSON.stringify(value)}`);

		return out.join('\n');
	}

	/**
	 * Called when the SettingsManager instance should be enabled.
	 */
	async onEnable() {
		// Before we do anything else, make sure the provider is ready.
		await this.provider.awaitReady();

		// When the router updates we additional routes, make sure to
		// trigger a rebuild of profile context and re-select profiles.
		this.on('site.router:updated-routes', this.updateRoutes, this);

		// Load profiles, but don't run any events because we haven't done
		// migrations yet.
		this.loadProfiles(true);

		// Handle migrations.
		//await this.migrations.process('core');

		// Now we can tell our context(s) about the profiles we have.
		for(const context of this.__contexts)
			context.selectProfiles();

		const duration = performance.now() - this._start_time;
		this.log.info(`Initialization complete after ${duration.toFixed(5)}ms -- Values: ${this.provider.size} -- Profiles: ${this.__profiles.length}`)

		this.scheduleUpdates();
	}


	// ========================================================================
	// Backup and Restore
	// ========================================================================

	async getFullBackup() {
		// Before we do anything else, make sure the provider is ready.
		await this.provider.awaitReady();

		const out = {
			version: 2,
			type: 'full',
			values: {}
		};

		for(const [k, v] of this.provider.entries())
			out.values[k] = v;

		return out;
	}


	scheduleUpdates() {
		if ( this._update_timer )
			clearTimeout(this._update_timer);

		this._update_timer = setTimeout(() => this.checkUpdates(), 5000);
	}


	checkUpdates() {
		const promises = [];
		for(const profile of this.__profiles) {
			if ( ! profile || ! profile.url )
				continue;

			const out = profile.checkUpdate();
			promises.push(out instanceof Promise ? out : Promise.resolve(out));
		}

		Promise.all(promises).then(data => {
			let success = 0;
			for(const thing of data)
				if ( thing )
					success++;

			this.log.info(`Successfully refreshed ${success} of ${data.length} profiles from remote URLs.`);
		});
	}


	// ========================================================================
	// Provider Interaction
	// ========================================================================

	/**
	 * Evaluate the environment that FFZ is running in and then decide which
	 * provider should be used to retrieve and store settings.
	 */
	_createProvider() {
		// If the loader has reported support for cloud settings...
		if ( document.body.classList.contains('ffz-cloud-storage') )
			return new CloudStorageProvider(this);

		// Fallback
		return new LocalStorageProvider(this);
	}


	/**
	 * React to a setting that has changed elsewhere. Generally, this is
	 * the result of a setting being changed in another tab or, when cloud
	 * settings are enabled, on another computer.
	 */
	_onProviderChange(key, new_value, deleted) {
		// If profiles have changed, reload our profiles.
		if ( key === 'profiles' )
			return this.loadProfiles();

		if ( ! key.startsWith('p:') )
			return;

		// If we're still here, it means an individual setting was changed.
		// Look up the profile it belongs to and emit a changed event from
		// that profile, thus notifying any contexts or UI instances.
		key = key.substr(2);
		const idx = key.indexOf(':');
		if ( idx === -1 )
			return;

		const profile = this.__profile_ids[key.slice(0, idx)],
			s_key = key.slice(idx + 1);

		if ( profile )
			profile.emit('changed', s_key, new_value, deleted);
	}


	// ========================================================================
	// Profile Management
	// ========================================================================

	updateRoutes() {
		// Clear the existing matchers.
		for(const profile of this.__profiles)
			profile.matcher = null;

		// And then re-select the active profiles.
		for(const context of this.__contexts)
			context.selectProfiles();
	}


	/**
	 * Get an existing {@link SettingsProfile} instance.
	 * @param {number} id  - The id of the profile.
	 */
	profile(id) {
		return this.__profile_ids[id] || null;
	}


	/**
	 * Build {@link SettingsProfile} instances for all of the profiles
	 * defined in storage, re-using existing instances when possible.
	 */
	loadProfiles(suppress_events) {
		const old_profile_ids = this.__profile_ids,
			old_profiles = this.__profiles,

			profile_ids = this.__profile_ids = {},
			profiles = this.__profiles = [],

			// Create a set of actual IDs with a map from the profiles
			// list rather than just getting the keys from the ID map
			// because the ID map is an object and coerces its strings
			// to keys.
			old_ids = new Set(old_profiles.map(x => x.id)),

			new_ids = new Set,
			changed_ids = new Set,

			raw_profiles = this.provider.get('profiles', [
				SettingsProfile.Moderation,
				SettingsProfile.Default
			]);

		let reordered = false,
			changed = false;

		for(const profile_data of raw_profiles) {
			const id = profile_data.id,
				slot_id = profiles.length,
				old_profile = old_profile_ids[id],
				old_slot_id = old_profile ? old_profiles.indexOf(old_profile) : -1;

			old_ids.delete(id);

			if ( old_slot_id !== slot_id )
				reordered = true;

			// Monkey patch to the new profile format...
			if ( profile_data.context && ! Array.isArray(profile_data.context) ) {
				if ( profile_data.context.moderator )
					profile_data.context = SettingsProfile.Moderation.context;
				else
					profile_data.context = null;
			}

			if ( old_profile && deep_equals(old_profile.data, profile_data, true) ) {
				// Did the order change?
				if ( old_slot_id !== slot_id )
					changed = true;

				profiles.push(profile_ids[id] = old_profile);
				continue;
			}

			const new_profile = profile_ids[id] = new SettingsProfile(this, profile_data);
			if ( old_profile ) {
				// Move all the listeners over.
				new_profile.__listeners = old_profile.__listeners;
				old_profile.__listeners = {};

				changed_ids.add(id);

			} else
				new_ids.add(id);

			profiles.push(new_profile);
			changed = true;
		}

		if ( ! changed && ! old_ids.size || suppress_events )
			return;

		for(const context of this.__contexts)
			context.selectProfiles();

		for(const id of new_ids)
			this.emit(':profile-created', profile_ids[id]);

		for(const id of changed_ids)
			this.emit(':profile-changed', profile_ids[id]);

		if ( reordered )
			this.emit(':profiles-reordered');
	}


	/**
	 * Create a new profile and return the {@link SettingsProfile} instance
	 * representing it.
	 * @returns {SettingsProfile}
	 */
	createProfile(options) {
		let i = 0;
		while( this.__profile_ids[i] )
			i++;

		options = options || {};
		options.id = i;

		if ( ! options.name )
			options.name = `Unnamed Profile ${i}`;

		const profile = this.__profile_ids[i] = new SettingsProfile(this, options);

		this.__profiles.unshift(profile);

		this._saveProfiles();
		this.emit(':profile-created', profile);
		return profile;
	}


	/**
	 * Delete a profile.
	 * @param {number|SettingsProfile} id - The profile to delete
	 */
	deleteProfile(id) {
		if ( typeof id === 'object' && id.id )
			id = id.id;

		const profile = this.__profile_ids[id];
		if ( ! profile )
			return;

		if ( profile.id === 0 )
			throw new Error('cannot delete default profile');

		profile.clear();
		this.__profile_ids[id] = null;

		const idx = this.__profiles.indexOf(profile);
		if ( idx !== -1 )
			this.__profiles.splice(idx, 1);

		this._saveProfiles();
		this.emit(':profile-deleted', profile);
	}


	moveProfile(id, index) {
		if ( typeof id === 'object' && id.id )
			id = id.id;

		const profile = this.__profile_ids[id];
		if ( ! profile )
			return;

		const profiles = this.__profiles,
			idx = profiles.indexOf(profile);
		if ( idx === index )
			return;

		profiles.splice(index, 0, ...profiles.splice(idx, 1));

		this._saveProfiles();
		this.emit(':profiles-reordered');
	}


	saveProfile(id) {
		if ( typeof id === 'object' && id.id )
			id = id.id;

		const profile = this.__profile_ids[id];
		if ( ! profile )
			return;

		this._saveProfiles();
		this.emit(':profile-changed', profile);
	}


	_saveProfiles() {
		this.provider.set('profiles', this.__profiles.map(prof => prof.data));
		for(const context of this.__contexts)
			context.selectProfiles();
	}


	// ========================================================================
	// Context Helpers
	// ========================================================================

	context(env) { return this.main_context.context(env) }
	get(key) { return this.main_context.get(key); }
	uses(key) { return this.main_context.uses(key) }
	update(key) { return this.main_context.update(key) }

	updateContext(context) { return this.main_context.updateContext(context) }
	setContext(context) { return this.main_context.setContext(context) }


	// ========================================================================
	// Definitions
	// ========================================================================

	add(key, definition) {
		if ( typeof key === 'object' ) {
			for(const k in key)
				if ( has(key, k) )
					this.add(k, key[k]);
			return;
		}

		const old_definition = this.definitions.get(key),
			required_by = old_definition ?
				(Array.isArray(old_definition) ? old_definition : old_definition.required_by) : [];

		definition.required_by = required_by;
		definition.requires = definition.requires || [];

		for(const req_key of definition.requires) {
			const req = this.definitions.get(req_key);
			if ( ! req )
				this.definitions.set(req_key, [key]);
			else if ( Array.isArray(req) )
				req.push(key);
			else
				req.required_by.push(key);
		}


		if ( definition.ui ) {
			const ui = definition.ui;
			ui.path_tokens = ui.path_tokens ?
				format_path_tokens(ui.path_tokens) :
				ui.path ?
					parse_path(ui.path) :
					undefined;

			if ( ! ui.key && ui.title )
				ui.key = ui.title.toSnakeCase();
		}

		if ( definition.changed )
			this.on(`:changed:${key}`, definition.changed);

		this.definitions.set(key, definition);
		this.emit(':added-definition', key, definition);
	}


	addUI(key, definition) {
		if ( typeof key === 'object' ) {
			for(const k in key)
				if ( has(key, k) )
					this.add(k, key[k]);
			return;
		}

		if ( ! definition.ui )
			definition = {ui: definition};

		const ui = definition.ui;
		ui.path_tokens = ui.path_tokens ?
			format_path_tokens(ui.path_tokens) :
			ui.path ?
				parse_path(ui.path) :
				undefined;

		if ( ! ui.key && ui.title )
			ui.key = ui.title.toSnakeCase();

		this.ui_structures.set(key, definition);
		this.emit(':added-definition', key, definition);
	}
}


const PATH_SPLITTER = /(?:^|\s*([~>]+))\s*([^~>@]+)\s*(?:@([^~>]+))?/g;

export function parse_path(path) {
	const tokens = [];
	let match;

	while((match = PATH_SPLITTER.exec(path))) {
		const page = match[1] === '>>',
			tab = match[1] === '~>',
			title = match[2].trim(),
			key = title.toSnakeCase(),
			options = match[3],

			opts = { key, title, page, tab };

		if ( options )
			Object.assign(opts, JSON.parse(options));

		tokens.push(opts);
	}

	return tokens;
}


export function format_path_tokens(tokens) {
	for(let i=0, l = tokens.length; i < l; i++) {
		const token = tokens[i];
		if ( typeof token === 'string' ) {
			tokens[i] = {
				key: token.toSnakeCase(),
				title: token
			}

			continue;
		}

		if ( ! token.key )
			token.key = token.title.toSnakeCase();
	}

	return tokens;
}