<?php
/**
 * Plugin Name: Acme Plugin
 */

require_once __DIR__ . '/includes/class-acme-admin.php';
require_once plugin_dir_path( __FILE__ ) . 'includes/helpers.php';
include 'includes/rest.php';

use Acme\Admin\Acme_Admin;

add_action( 'init', 'acme_register_post_types' );
add_filter( 'the_content', 'acme_append_footer', 20 );
add_action( 'woocommerce_checkout_order_processed', 'acme_on_order', 10, 1 );
add_shortcode( 'acme_box', 'acme_box_shortcode' );
add_action( 'wp_footer', function () {
	echo acme_footer_html();
} );

$acme_admin = new Acme_Admin();

function acme_register_post_types() {
	register_post_type( 'acme_item', array( 'public' => true ) );
	do_action( 'acme_after_register' );
}

function acme_append_footer( $content ) {
	return $content . acme_footer_html();
}

function acme_on_order( $order_id ) {
	acme_log( 'order ' . $order_id );
}

function acme_box_shortcode( $atts ) {
	return '<div class="acme-box">' . esc_html( $atts['title'] ?? '' ) . '</div>';
}
