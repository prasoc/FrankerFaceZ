'use strict';

// ============================================================================
// Switchboard
// A hack for React Router to make it load a module.
// ============================================================================

import Module from 'utilities/module';
import pathToRegexp from 'path-to-regexp';


export default class Switchboard extends Module {
	constructor(...args) {
		super(...args);

		this.inject('site.web_munch');
		this.inject('site.fine');
	}

	async onEnable() {
		await this.parent.awaitElement('.clips-root');
		if ( this.web_munch._require || this.web_munch.v4 === false )
			return;

		const da_switch = this.fine.searchTree(null, n =>
			n.context && n.context.router &&
			n.props && n.props.children &&
			n.componentWillMount && n.componentWillMount.toString().includes('Switch')
		);

		if ( ! da_switch )
			return new Promise(r => setTimeout(r, 50)).then(() => this.onEnable());


		// Identify Router
		this.log.info(`Found Switch with ${da_switch.props.children.length} routes.`);

		const location = da_switch.context.router.route.location.pathname;

		for(const route of da_switch.props.children) {
			if ( ! route.props || ! route.props.component )
				continue;

			try {
				const reg = pathToRegexp(route.props.path);
				if ( ! reg.exec || reg.exec(location) )
					continue;

			} catch(err) {
				continue;
			}

			this.log.info('Found Non-Matching Route', route.props.path);

			let component;

			try {
				component = new route.props.component;
			} catch(err) {
				this.log.error('Error instantiating component for forced chunk loading.', err);
				component = null;
			}

			if ( ! component || ! component.props || ! component.props.children || ! component.props.children.props || ! component.props.children.props.loader )
				continue;

			try {
				component.props.children.props.loader().then(() => {
					this.log.info('Successfully forced a chunk to load using route', route.props.path)
				});
			} catch(err) {
				this.log.warn('Unexpected result trying to use component loader to force loading of another chunk.');
			}

			return;
		}

		this.log.warn('Unable to use any of the available routes.');
	}
}