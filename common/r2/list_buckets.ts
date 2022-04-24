import { ExtendedXmlNode, parseXml } from '../xml_parser.ts';
import { AwsCallContext, BucketResultOwner, computeHeadersString, parseBucketResultOwner, R2, s3Fetch } from './r2.ts';
import { KnownElement } from './known_element.ts';

export async function listBuckets(opts: { origin: string, region: string }, context: AwsCallContext): Promise<ListBucketsResult> {
    const { origin, region } = opts;
    const method = 'GET';
    const url = new URL(`${origin}/`);

    const res = await s3Fetch({ method, url, region, context });
    const contentType = res.headers.get('content-type') || undefined;
    const txt = await res.text();
    if (R2.DEBUG) console.log(txt);
    const expectedStatus = res.status === 200;
    if (!expectedStatus || contentType !== 'application/xml') {
        const { status, headers, url } = res;
        const value = !expectedStatus ? `status ${status}` : `content type ${contentType}`;
        throw new Error(`Unexpected ${value} for ${url}, headers=${computeHeadersString(headers)} body=${txt}`);
    }
    const xml = parseXml(txt);
    return parseListBucketsResultXml(xml);
}

//

export interface ListBucketsResult {
    readonly buckets: readonly ListBucketsBucketItem[];
    readonly owner: BucketResultOwner;
}

export interface ListBucketsBucketItem {
    readonly name: string;
    readonly creationDate: string;
}

//

function parseListBucketsResultXml(xml: ExtendedXmlNode): ListBucketsResult {
    const doc = new KnownElement(xml).checkTagName('!xml');
    const rt = parseListBucketsResult(doc.getKnownElement('ListAllMyBucketsResult'));
    doc.check();
    return rt;
}

function parseListBucketsResult(element: KnownElement): ListBucketsResult {
    const owner = parseBucketResultOwner(element.getKnownElement('Owner'));
    const buckets = parseBuckets(element.getKnownElement('Buckets'));

    element.check();
    return { owner, buckets };
}

function parseBuckets(element: KnownElement): ListBucketsBucketItem[] {
    const rt = element.getKnownElements('Bucket').map(parseListBucketsBucketItem);
    element.check();
    return rt;
}

function parseListBucketsBucketItem(element: KnownElement): ListBucketsBucketItem {
    const creationDate = element.getElementText('CreationDate');
    const name = element.getElementText('Name');

    element.check();
    return { creationDate, name };
}