import { describe, expect, it } from 'vitest';
import { builderFor, edgeList, fixture } from './helpers';

const FLOW = ['registers', 'calls'];
const flowEdges = (g: Parameters<typeof edgeList>[0]) =>
  edgeList(g, FLOW).filter((e) => /hook:|route:|shortcode:|closure/.test(e));

describe('framework flow layer (golden graphs)', () => {
  it('WordPress: actions, filters, closures, shortcodes, REST routes, do_action, WooCommerce', async () => {
    const g = (await builderFor(fixture('wp-plugin'))).build();
    expect(flowEdges(g)).toMatchInlineSnapshot(`
      [
        "function:acme_register_post_types -> hook:acme_after_register (calls)",
        "function:closure:rest_api_init callback -> route:GET /acme/v1/items (registers)",
        "function:closure:wp_footer callback -> function:acme_footer_html (calls)",
        "hook:acme_after_register -> method:Acme_Admin.flush (registers)",
        "hook:admin_menu -> method:Acme_Admin.add_menu (registers)",
        "hook:init -> function:acme_register_post_types (registers)",
        "hook:rest_api_init -> function:closure:rest_api_init callback (registers)",
        "hook:the_content -> function:acme_append_footer (registers)",
        "hook:woocommerce_checkout_order_processed -> function:acme_on_order (registers)",
        "hook:wp_footer -> function:closure:wp_footer callback (registers)",
        "route:GET /acme/v1/items -> function:acme_rest_list_items (registers)",
        "shortcode:[acme_box] -> function:acme_box_shortcode (registers)",
      ]
    `);
    expect(g.nodes.get('wp::hook::woocommerce_checkout_order_processed')?.meta).toMatchObject({
      woocommerce: true,
      type: 'action',
    });
    expect(g.nodes.get('wp::hook::the_content')?.meta).toMatchObject({ type: 'filter' });
  });

  it('JS: Express routes (named + inline handlers) and Next.js route handlers', async () => {
    const g = (await builderFor(fixture('js-app'))).build();
    expect(flowEdges(g)).toMatchInlineSnapshot(`
      [
        "function:closure:POST /users handler -> function:createUser (calls)",
        "route:GET /api/items -> function:GET (registers)",
        "route:GET /health -> function:health (registers)",
        "route:POST /users -> function:closure:POST /users handler (registers)",
      ]
    `);
  });

  it('Python: Flask decorator and add_url_rule routes', async () => {
    const g = (await builderFor(fixture('py-app'))).build();
    expect(flowEdges(g)).toMatchInlineSnapshot(`
      [
        "route:GET / -> function:index (registers)",
        "route:GET /users -> function:list_users (registers)",
      ]
    `);
  });

  it('changing a callback name re-points the hook edge', async () => {
    const b = await builderFor(fixture('wp-plugin'));
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(fixture('wp-plugin/includes/helpers.php'), 'utf8');
    b.setFile(
      'acme-plugin.php',
      readFileSync(fixture('wp-plugin/acme-plugin.php'), 'utf8').replace(
        "'init', 'acme_register_post_types'",
        "'init', 'acme_log'",
      ),
    );
    b.setFile('includes/helpers.php', src);
    const { diffGraphs } = await import('../../src/graph/GraphDiffer');
    const before = (await builderFor(fixture('wp-plugin'))).build();
    const d = diffGraphs(before, b.build());
    expect(d.addedEdges).toEqual(['wp::hook::init->includes/helpers.php::function::acme_log::registers']);
    expect(d.removedEdges).toEqual([
      'wp::hook::init->acme-plugin.php::function::acme_register_post_types::registers',
    ]);
  });
});

describe('closure ids are stable and unique', () => {
  const build = async (file: string, text: string) => {
    const { GraphBuilder } = await import('../../src/graph/GraphBuilder');
    const { extractors } = await import('../../src/graph/extractors');
    const { getParser } = await import('./helpers');
    const b = new GraphBuilder(await getParser(), extractors);
    b.setFile(file, text);
    const g = b.build();
    return {
      nodes: [...g.nodes.keys()].filter((id) => id.includes('closure')).sort(),
      edges: [...g.edges.values()]
        .map((e) => `${e.from.split('::').pop()} -> ${e.to.split('::').pop()}`)
        .sort(),
    };
  };

  it('inserting a line above a closure keeps its id (no removed+added)', async () => {
    const php = "<?php\nadd_action('init', function () { helper(); });\nfunction helper() {}\n";
    const js = "app.get('/a', (req, res) => { go(); });\nfunction go() {}\n";
    expect(await build('p.php', php.replace('<?php\n', '<?php\n// note\n'))).toEqual(
      await build('p.php', php),
    );
    expect(await build('s.js', `// note\n${js}`)).toEqual(await build('s.js', js));
  });

  it('two closures on one line get separate nodes and the right edges', async () => {
    const g = await build(
      'p.php',
      "<?php\nadd_action('a', function(){ fa(); }); add_action('b', function(){ fb(); });\nfunction fa(){}\nfunction fb(){}\n",
    );
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toContain('closure:a callback -> fa');
    expect(g.edges).toContain('closure:b callback -> fb');
  });
});
