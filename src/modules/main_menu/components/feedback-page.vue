<template lang="html">
	<div class="ffz--home tw-border-t tw-pd-y-1">
		<markdown :source="t('home.feedback', md)" />
	</div>
</template>

<script>

import FEEDBACK_MD from '../feedback.md';

export default {
	props: ['item', 'context'],

	data() {
		return {
			md: FEEDBACK_MD
		}
	}
}
</script>