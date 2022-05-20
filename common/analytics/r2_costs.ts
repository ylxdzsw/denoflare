import { Bucket, listR2Buckets } from '../cloudflare_api.ts';
import { Profile } from '../config.ts';
import { CfGqlClient, CfGqlResultInfo } from './cfgql_client.ts';

export async function computeR2CostsTable(client: CfGqlClient, opts: { lookbackDays: number } | { start: string, end: string }): Promise<R2CostsTable> {
    const { start, end } = (() => {
        if ('lookbackDays' in opts) {
            const end = utcCurrentDate();
            const start = addDaysToDate(end, -opts.lookbackDays);
            return { start, end };
        } else {
            const { start, end } = opts;
            return { start, end };
        }
    })();
   
    const [ storage, operationsA, operationsB, buckets ] = await Promise.all([ 
        client.getR2StorageByDate(start, end),
        client.getR2OperationsByDate('A', start, end),
        client.getR2OperationsByDate('B', start, end),
        tryListBuckets(client.profile),
    ]);

    const gqlResultInfos = {
        'storage': storage.info,
        'operationsA': operationsA.info,
        'operationsB': operationsB.info,
    };

    const rowsByBucket: Record<string, R2CostsRow[]> = {};
    const rowsByDate: Record<string, R2CostsRow[]> = {};
    for (const pRow of storage.rows) {
        const { 
            date,
            bucketName,
            maxMetadataSize,
            maxPayloadSize,
            maxObjectCount: objectCount,
            maxUploadCount: uploadCount,
         } = pRow;
        let rows = rowsByBucket[bucketName];
        if (!rows) {
            rows = [];
            rowsByBucket[bucketName] = rows;
        }
        let dateRows = rowsByDate[date];
        if (!dateRows) {
            dateRows = [];
            rowsByDate[date] = dateRows;
        }
        const { sumSuccessfulRequests: classAOperations } = operationsA.rows.filter(v => v.date === date && v.bucketName === bucketName)[0] || { sumSuccessfulRequests: 0 };
        const { sumSuccessfulRequests: classBOperations } = operationsB.rows.filter(v => v.date === date && v.bucketName === bucketName)[0] || { sumSuccessfulRequests: 0 };

        const { classAOperationsCost, classBOperationsCost, storageGb, storageGbMo, storageCost, totalCost } = 
            computeCosts({ classAOperations, classBOperations, maxMetadataSize, maxPayloadSize, excludeFreeUsage: false });

        const row: R2CostsRow = {
            date,
            classAOperations,
            classAOperationsCost,
            classBOperations,
            classBOperationsCost,
            objectCount,
            uploadCount,
            storageGb,
            storageGbMo,
            storageCost,
            totalCost,
        };
        rows.push(row);
        dateRows.push(row);
    }
    const bucketTables: Record<string, R2DailyCostsTable> = {};
    for (const [ bucketName, rows] of Object.entries(rowsByBucket)) {
        const bucket = buckets.find(v => v.name === bucketName);
        const totalRow = computeTotalRow('', rows);
        bucketTables[bucketName] = { rows, totalRow, bucket };
    }
    const accountRows: R2CostsRow[] = [];
    for (const [ date, dateRows] of Object.entries(rowsByDate)) {
        accountRows.push(computeTotalRow(date, dateRows));
    }
    const totalRow = computeTotalRow('', accountRows);
    const accountTable: R2DailyCostsTable = { rows: accountRows, totalRow, bucket: undefined };
    return { accountTable, bucketTables, gqlResultInfos };
}

export interface R2CostsTable {
    readonly accountTable: R2DailyCostsTable;
    readonly bucketTables: Record<string, R2DailyCostsTable>; // key = bucket name
    readonly gqlResultInfos: Record<string, CfGqlResultInfo>;
}

export interface R2DailyCostsTable {
    readonly rows: readonly R2CostsRow[];
    readonly totalRow: R2CostsRow;
    readonly bucket: Bucket | undefined;
}

export interface R2CostsRow {
    readonly date: string;

    readonly classAOperations: number;
    readonly classAOperationsCost: number;
    readonly classBOperations: number;
    readonly classBOperationsCost: number;

    readonly objectCount: number;
    readonly uploadCount: number;
    readonly storageGb: number;
    readonly storageGbMo: number;
    readonly storageCost: number;
    readonly totalCost: number;
}

//

function computeCosts(input: { classAOperations: number, classBOperations: number, maxMetadataSize: number, maxPayloadSize: number
        excludeFreeUsage: boolean }) {
    const { classAOperations, classBOperations, maxMetadataSize, maxPayloadSize, excludeFreeUsage } = input;

    const classAOperationsCost = (excludeFreeUsage ? Math.max(classAOperations - 1000000, 0) : classAOperations) / 1000000 * 4.50; // $4.50 / million requests, 1,000,000 included per month
    const classBOperationsCost = (excludeFreeUsage ? Math.max(classBOperations - 10000000, 0): classBOperations) / 1000000 * 4.50; // $0.36 / million requests, 10,000,000 included per month
    const storageGb = (maxMetadataSize + maxPayloadSize) / 1024 / 1024 / 1024;
    const storageGbMo = storageGb / 30;
    let storageCost = storageGbMo * 0.015; // $0.015 per 1 GB-month of storage
    if (excludeFreeUsage) storageCost = Math.max(0, storageCost - 0.15); // 10 GB-month = $0.15 free
    const totalCost = classAOperationsCost + classBOperationsCost + storageCost;

    return { classAOperationsCost, classBOperationsCost, storageGb, storageGbMo, storageCost, totalCost };
}

async function tryListBuckets(profile: Profile): Promise<readonly Bucket[]> {
    try {
        return await listR2Buckets(profile.accountId, profile.apiToken);
    } catch (e) {
        console.warn(e);
        return [];
    }
}

function computeTotalRow(date: string, rows: R2CostsRow[]): R2CostsRow {
    const rt = rows.reduce((lhs, rhs) => ({
        date,
        classAOperations: lhs.classAOperations + rhs.classAOperations,
        classAOperationsCost: lhs.classAOperationsCost + rhs.classAOperationsCost,
        classBOperations: lhs.classBOperations + rhs.classBOperations,
        classBOperationsCost: lhs.classBOperationsCost + rhs.classBOperationsCost,
        objectCount: lhs.objectCount + rhs.objectCount,
        uploadCount: lhs.uploadCount + rhs.uploadCount,
        storageGb: lhs.storageGb + rhs.storageGb,
        storageGbMo: lhs.storageGbMo + rhs.storageGbMo,
        storageCost: lhs.storageCost + rhs.storageCost,
        totalCost: lhs.totalCost + rhs.totalCost,
    }));
    return rt;
}

function utcCurrentDate(): string {
    return new Date().toISOString().substring(0, 10);
}

function addDaysToDate(date: string, days: number) {
    const d = new Date(`${date}T00:00:00Z`);
    return new Date(
        d.getFullYear(), 
        d.getMonth(), 
        d.getDate() + days,
        d.getHours(),
        d.getMinutes(),
        d.getSeconds(),
        d.getMilliseconds()
    ).toISOString().substring(0, 10);
}