<template lang="html">
	<div class="ffz--addon-info tw-elevation-1 tw-c-background-base tw-border tw-pd-1 tw-mg-b-1 tw-flex tw-flex-nowrap">
		<div class="tw-flex tw-flex-column tw-align-center tw-flex-shrink-0 tw-mg-r-1">
			<div class="tw-card-img--size-6 tw-overflow-hidden tw-mg-b-1">
				<img :src="icon" class="tw-image">
			</div>

			<div v-if="external" class="tw-mg-b-05 tw-pill">
				{{ t('addon.external', 'External') }}
			</div>

			<div v-else-if="enabled" class="tw-mg-b-05 tw-pill ffz--pill-enabled">
				{{ t('addon.enabled', 'Enabled') }}
			</div>

			<div v-if="addon.dev" class="tw-mg-b-05 tw-pill">
				{{ t('addon.dev', 'Developer') }}
			</div>

			<div v-if="addon.unlisted" class="tw-mg-b-05 tw-pill">
				{{ t('addon.unlisted', 'Unlisted') }}
			</div>
		</div>

		<div class="tw-flex-grow-1">
			<div class="tw-border-b tw-mg-b-05">
				<h4>{{ t(addon.name_i18n, addon.name) }} <span class="tw-c-text-alt-2 tw-font-size-6">({{ addon.id }})</span></h4>
				<span class="tw-c-text-alt tw-mg-r-1">
					{{ t('addon.author', 'By: {author}', {
						author: t(addon.author_i18n, addon.author)
					}) }}
				</span>
				<span v-if="version" class="tw-c-text-alt">
					{{ t('addon.version', 'Version {version}', {version}) }}
				</span>
			</div>
			<markdown :source="show_description" />
			<a
				v-if="multi_line"
				href="#"
				class="tw-c-text-alt-2"
				@click.prevent="toggle"
			>
				<template v-if="expanded">{{ t('addon.show-less', '(Show Less)') }}</template>
				<template v-else>{{ t('addon.show-more', '(Show More)') }}</template>
			</a>

			<div class="tw-mg-t-1 tw-pd-t-1 tw-border-t">
				<template v-if="enabled">
					<button
						v-if="external"
						disabled
						class="tw-button tw-button--hollow tw-button--disabled tw-tooltip-wrapper tw-mg-r-1"
					>
						<span class="tw-button__icon tw-button__icon--left">
							<figure class="ffz-i-trash" />
						</span>
						<span class="tw-button__text">
							{{ t('addon.disable', 'Disable') }}
						</span>
						<div class="tw-tooltip tw-tooltip--up tw-tooltip--align-left">
							{{ t('addon.external.description', 'This add-on has been loaded by an external script and cannot be disabled here.') }}
						</div>
					</button>
					<button
						v-else
						class="tw-button tw-button--hollow ffz--button-disable tw-mg-r-1"
						@click="item.disableAddon(id)"
					>
						<span class="tw-button__icon tw-button__icon--left">
							<figure class="ffz-i-trash" />
						</span>
						<span class="tw-button__text">
							{{ t('addon.disable', 'Disable') }}
						</span>
					</button>
					<button
						v-if="addon.settings"
						class="tw-button tw-button--hollow tw-mg-r-1"
						@click="openSettings()"
					>
						<span class="tw-button__icon tw-button__icon--left">
							<figure class="ffz-i-cog" />
						</span>
						<span class="tw-button__text">
							{{ t('addon.settings', 'Settings') }}
						</span>
					</button>
				</template>
				<template v-else>
					<button
						class="tw-button tw-button--hollow ffz--button-enable tw-mg-r-1"
						@click="item.enableAddon(id)"
					>
						<span class="tw-button__icon tw-button__icon--left">
							<figure class="ffz-i-download" />
						</span>
						<span class="tw-button__text">
							{{ t('addon.enable', 'Enable') }}
						</span>
					</button>
				</template>
				<a
					v-if="addon.website"
					:href="addon.website"
					:title="addon.website"
					class="tw-button tw-button--hollow tw-mg-r-1"
					target="_blank"
					rel="noopener"
				>
					<span class="tw-button__icon tw-button__icon--left">
						<figure class="ffz-i-link-ext" />
					</span>
					<span class="tw-button__text">
						{{ t('addon.website', 'Website') }}
					</span>
				</a>
			</div>
		</div>
	</div>
</template>

<script>

export default {
	props: ['id', 'addon', 'item'],

	data() {
		let description;
		if ( this.addon.description_i18n )
			description = this.t(this.addon.description_i18n, this.addon.description);
		else
			description = this.addon.description;

		const lines = description.split(/\n/);

		return {
			description,
			multi_line: lines.length > 1,
			first_line: lines[0],
			enabled: this.item.isAddonEnabled(this.id),
			external: this.item.isAddonExternal(this.id),
			version: this.item.getVersion(this.id),
			expanded: false
		}
	},

	computed: {
		icon() {
			return this.addon.icon || 'https://cdn.frankerfacez.com/badge/2/4/solid'
		},

		show_description() {
			if ( this.expanded )
				return this.description;
			return this.first_line;
		}
	},

	created() {
		this.item.on('i18n:update', this.updateDescription, this);
		this.item.on(':added', this.refreshExternal, this);
		this.item.on(':ready', this.refreshExternal, this);
		this.item.on(':addon-enabled', this.onEnabled, this);
		this.item.on(':addon-disabled', this.onDisabled, this);
	},

	destroyed() {
		this.item.off('i18n:update', this.updateDescription, this);
		this.item.off(':added', this.refreshExternal, this);
		this.item.off(':ready', this.refreshExternal, this);
		this.item.off(':addon-enabled', this.onEnabled, this);
		this.item.off(':addon-disabled', this.onDisabled, this);
	},

	methods: {
		refreshExternal() {
			this.external = this.item.isAddonExternal(this.id);
			this.version = this.item.getVersion(this.id);
		},

		updateDescription() {
			if ( this.addon.description_i18n )
				this.description = this.t(this.addon.description_i18n, this.addon.description);
			else
				this.description = this.addon.description;

			const lines = this.description.split(/\n/);

			this.multi_line = lines.length > 1;
			this.first_line = lines[0];
		},

		onEnabled(id) {
			if ( id === this.id )
				this.enabled = true;

			this.version = this.item.getVersion(this.id);
		},

		onDisabled(id) {
			if ( id === this.id )
				this.enabled = false;
		},

		toggle() {
			this.expanded = ! this.expanded
		},

		openSettings() {
			if ( typeof this.addon.settings === 'string' ) {
				this.$emit('navigate', this.addon.settings);
				return;
			}

			const list = [`add_ons.${this.id}`];
			if ( this.addon.short_name )
				list.push(`add_ons.${this.addon.short_name.toSnakeCase()}`);
			if ( this.addon.name )
				list.push(`add_ons.${this.addon.name.toSnakeCase()}`);

			this.$emit('navigate', ...list);
		}
	}
}

</script>