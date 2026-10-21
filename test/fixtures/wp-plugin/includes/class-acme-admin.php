<?php
namespace Acme\Admin;

class Acme_Admin {
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'add_menu' ) );
		add_action( 'acme_after_register', [ $this, 'flush' ] );
	}

	public function add_menu() {
		add_menu_page( 'Acme', 'Acme', 'manage_options', 'acme', [ $this, 'render' ] );
	}

	public function render() {
		echo $this->title();
	}

	private function title() {
		return 'Acme';
	}

	public function flush() {
		acme_log( 'flushed' );
	}
}
