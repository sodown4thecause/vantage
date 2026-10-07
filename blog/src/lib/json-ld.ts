/** Serialize for an inline `<script type="application/ld+json">`; escaping `<` stops `</script>` in content from closing the tag. */
export const serializeJsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
