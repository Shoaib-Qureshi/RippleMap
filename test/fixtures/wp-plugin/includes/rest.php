<?php
add_action( 'rest_api_init', function () {
	register_rest_route( 'acme/v1', '/items', array(
		'methods'  => 'GET',
		'callback' => 'acme_rest_list_items',
	) );
} );

function acme_rest_list_items( $request ) {
	acme_log( 'list' );
	return rest_ensure_response( array() );
}
