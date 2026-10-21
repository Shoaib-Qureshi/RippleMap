<?php
function acme_footer_html() {
	return '<footer>Acme</footer>';
}

function acme_log( $msg ) {
	error_log( $msg );
}
