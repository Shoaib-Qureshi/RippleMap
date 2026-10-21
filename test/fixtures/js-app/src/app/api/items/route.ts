import { helper } from '../../../lib/util';

export async function GET() {
  return Response.json(helper([]));
}
