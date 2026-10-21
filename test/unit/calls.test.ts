import { describe, expect, it } from 'vitest';
import { builderFor, edgeList, fixture, symbolList } from './helpers';

const FN_EDGES = ['calls', 'renders', 'extends'];

describe('calls extractor (golden graphs)', () => {
  it('JS/TS: functions, arrow functions, components, calls and JSX renders', async () => {
    const g = (await builderFor(fixture('js-app'))).build();
    expect(symbolList(g)).toMatchInlineSnapshot(`
      [
        "component:App",
        "component:Button",
        "function:GET",
        "function:closure@L12",
        "function:createUser",
        "function:health",
        "function:helper",
        "function:load",
        "function:main",
        "function:start",
        "function:util",
        "route:GET /api/items",
        "route:GET /health",
        "route:POST /users",
      ]
    `);
    expect(edgeList(g, FN_EDGES)).toMatchInlineSnapshot(`
      [
        "component:App -> component:Button (renders)",
        "function:GET -> function:helper (calls)",
        "function:closure@L12 -> function:createUser (calls)",
        "function:createUser -> function:helper (calls)",
        "function:main -> function:start (calls)",
        "function:main -> function:util (calls)",
        "function:start -> function:helper (calls)",
        "function:util -> function:helper (calls)",
      ]
    `);
  });

  it('Python: classes, methods, self calls, cross-module calls', async () => {
    const g = (await builderFor(fixture('py-app'))).build();
    expect(symbolList(g)).toMatchInlineSnapshot(`
      [
        "class:User",
        "function:boot",
        "function:greet",
        "function:index",
        "function:list_users",
        "function:register",
        "method:User.__init__",
        "method:User.display",
        "method:User.format_name",
        "route:GET /",
        "route:GET /users",
      ]
    `);
    expect(edgeList(g, FN_EDGES)).toMatchInlineSnapshot(`
      [
        "function:boot -> function:register (calls)",
        "function:index -> function:greet (calls)",
        "function:list_users -> class:User (calls)",
        "method:User.display -> method:User.format_name (calls)",
      ]
    `);
  });

  it('PHP: functions, classes, $this-> methods, new', async () => {
    const g = (await builderFor(fixture('wp-plugin'))).build();
    expect(symbolList(g)).toMatchInlineSnapshot(`
      [
        "class:Acme_Admin",
        "function:acme_append_footer",
        "function:acme_box_shortcode",
        "function:acme_footer_html",
        "function:acme_log",
        "function:acme_on_order",
        "function:acme_register_post_types",
        "function:acme_rest_list_items",
        "function:closure@L16",
        "function:closure@L2",
        "hook:acme_after_register",
        "hook:admin_menu",
        "hook:init",
        "hook:rest_api_init",
        "hook:the_content",
        "hook:woocommerce_checkout_order_processed",
        "hook:wp_footer",
        "method:Acme_Admin.__construct",
        "method:Acme_Admin.add_menu",
        "method:Acme_Admin.flush",
        "method:Acme_Admin.render",
        "method:Acme_Admin.title",
        "route:GET /acme/v1/items",
        "shortcode:[acme_box]",
      ]
    `);
    expect(edgeList(g, FN_EDGES)).toMatchInlineSnapshot(`
      [
        "acme-plugin.php -> class:Acme_Admin (calls)",
        "function:acme_append_footer -> function:acme_footer_html (calls)",
        "function:acme_on_order -> function:acme_log (calls)",
        "function:acme_register_post_types -> hook:acme_after_register (calls)",
        "function:acme_rest_list_items -> function:acme_log (calls)",
        "function:closure@L16 -> function:acme_footer_html (calls)",
        "method:Acme_Admin.flush -> function:acme_log (calls)",
        "method:Acme_Admin.render -> method:Acme_Admin.title (calls)",
      ]
    `);
  });
});

describe('function-level diff', () => {
  it('editing one function body marks only that function modified; a new call is an added edge', async () => {
    const b = await builderFor(fixture('js-app'));
    const before = b.build();
    b.setFile(
      'src/lib/util.ts',
      'export const util = () => helper();\n\n// moved down a line\nexport function helper(x?: unknown) {\n  util();\n  return x;\n}\n',
    );
    const after = b.build();
    const { diffGraphs } = await import('../../src/graph/GraphDiffer');
    const d = diffGraphs(before, after);
    expect(d.modifiedNodes.sort()).toEqual([
      'src/lib/util.ts::file::src/lib/util.ts',
      'src/lib/util.ts::function::helper',
    ]);
    expect(d.addedEdges).toEqual([
      'src/lib/util.ts::function::helper->src/lib/util.ts::function::util::calls',
    ]);
    expect(d.summary).toBe('Adds 1 call; changes 1 function; affects 4 callers.');
  });
});
