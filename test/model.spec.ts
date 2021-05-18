import txpb from "@kinecosystem/agora-api/node/transaction/v4/transaction_service_pb";
import * as solanaweb3 from "@solana/web3.js";
import BigNumber from "bignumber.js";
import hash from "hash.js";
import { xdr } from "stellar-base";
import { invoiceToProto, kinToQuarks, Memo, PrivateKey, quarksToKin, TransactionState, TransactionType, txDataFromProto, xdrInt64ToBigNumber } from "../src";
import { createHistoryItem, createInvoiceList } from "../src/proto/utils";
import { MemoProgram } from "../src/solana/memo-program";
import { TokenProgram } from "../src/solana/token-program";

test("XdrInt64ToBigNumber", () => {
    const i64 = new xdr.Int64(1145307136, 572653568);
    expect(xdrInt64ToBigNumber(i64)).toStrictEqual(new BigNumber("2459528347643019264"));
});

test("kin to quark conversion", () => {
    const validCases = new Map<string, string>([
        ["0.00001", "1"],
        ["0.00002", "2"],
        ["1", "1e5"],
        ["2", "2e5"],
        // 10 trillion, more than what's in cicrulation
        ["10000000000000", "1e18"],
    ]);
    validCases.forEach((expected, input) => {
        expect(kinToQuarks(input)).toStrictEqual(new BigNumber(expected));
        expect(quarksToKin(expected)).toStrictEqual(new BigNumber(input).toString());
    });

    const roundedCases = new Map<string, string>([
        ["0.000001", "0"],
        ["0.000015", "1"],
        ["0.000018", "1"],
    ]);
    roundedCases.forEach((expected, input) => {
        expect(kinToQuarks(input)).toStrictEqual(new BigNumber(expected));
    });
});

test("txDataFromProto", () => {
    const account1 = PrivateKey.random();
    const account2 = PrivateKey.random();
    const owner = PrivateKey.random();
    const tokenProgram = PrivateKey.random().publicKey().solanaKey();
    const recentBlockhash = new solanaweb3.Account().publicKey.toBase58();
    const invoices = [
        {
            Items: [
                {
                    title: "t1",
                    description: "d2",
                    amount: new BigNumber(10),
                },
            ]
        },
        {
            Items: [
                {
                    title: "t3",
                    description: "d4",
                    amount: new BigNumber(15),
                },
            ]
        },
    ];

    const serializedInvoiceList = createInvoiceList({ invoices: invoices }).serializeBinary();
    const fk = Buffer.from(hash.sha224().update(serializedInvoiceList).digest('hex'), "hex");
    const kinMemo = Memo.new(1, TransactionType.P2P, 0, fk);
    const tx = new solanaweb3.Transaction({ 
        feePayer: owner.publicKey().solanaKey(),
        recentBlockhash: recentBlockhash,
     }).add(
        MemoProgram.memo({ data: kinMemo.buffer.toString('base64') }),
        TokenProgram.transfer({
            source: account1.publicKey().solanaKey(),
            dest: account2.publicKey().solanaKey(),
            owner: owner.publicKey().solanaKey(),
            amount: BigInt(10),
        }, tokenProgram),
        TokenProgram.transfer({
            source: account2.publicKey().solanaKey(),
            dest: account1.publicKey().solanaKey(),
            owner: owner.publicKey().solanaKey(),
            amount: BigInt(15),
        }, tokenProgram),
    );
    tx.setSigners(owner.publicKey().solanaKey());
    owner.kp.secret();
    tx.sign(new solanaweb3.Account(owner.secretKey()));

    const historyItem = createHistoryItem({
        transactionId: Buffer.from('someid'),
        cursor: undefined,
        stellarTxEnvelope: undefined,
        solanaTx: tx.serialize(),
        payments: [
            {
                source: account1.publicKey(),
                destination: account2.publicKey(),
                amount: new BigNumber(10),
            },
            {
                source: account2.publicKey(),
                destination: account1.publicKey(),
                amount: new BigNumber(15),
            },
        ],
        invoices: invoices,
    });

    const txData = txDataFromProto(historyItem, txpb.GetTransactionResponse.State.SUCCESS);
    expect(txData.txId).toEqual(Buffer.from('someid'));
    expect(txData.txState).toEqual(TransactionState.Success);
    expect(txData.payments).toHaveLength(2);

    expect(txData.payments[0].sender.buffer).toEqual(account1.kp.rawPublicKey());
    expect(txData.payments[0].destination.buffer).toEqual(account2.kp.rawPublicKey());
    expect(txData.payments[0].type).toEqual(TransactionType.P2P);
    expect(txData.payments[0].quarks).toEqual("10");
    expect(invoiceToProto(txData.payments[0].invoice!).serializeBinary()).toEqual(invoiceToProto(invoices[0]).serializeBinary());
    expect(txData.payments[0].memo).toBeUndefined();

    expect(txData.payments[1].sender.buffer).toEqual(account2.kp.rawPublicKey());
    expect(txData.payments[1].destination.buffer).toEqual(account1.kp.rawPublicKey());
    expect(txData.payments[1].type).toEqual(TransactionType.P2P);
    expect(txData.payments[1].quarks).toEqual("15");
    expect(invoiceToProto(txData.payments[1].invoice!).serializeBinary()).toEqual(invoiceToProto(invoices[1]).serializeBinary());
    expect(txData.payments[0].memo).toBeUndefined();
});

test("txDataFromProto no invoices", () => {
    const account1 = PrivateKey.random();
    const account2 = PrivateKey.random();
    const owner = PrivateKey.random();
    const tokenProgram = PrivateKey.random().publicKey().solanaKey();
    const recentBlockhash = new solanaweb3.Account().publicKey.toBase58();
    const kinMemo = Memo.new(1, TransactionType.P2P, 0, Buffer.alloc(0));
    const tx = new solanaweb3.Transaction({ 
        feePayer: owner.publicKey().solanaKey(),
        recentBlockhash: recentBlockhash,
     }).add(
        MemoProgram.memo({ data: kinMemo.buffer.toString('base64') }),
        TokenProgram.transfer({
            source: account1.publicKey().solanaKey(),
            dest: account2.publicKey().solanaKey(),
            owner: owner.publicKey().solanaKey(),
            amount: BigInt(10),
        }, tokenProgram),
        TokenProgram.transfer({
            source: account2.publicKey().solanaKey(),
            dest: account1.publicKey().solanaKey(),
            owner: owner.publicKey().solanaKey(),
            amount: BigInt(15),
        }, tokenProgram),
    );
    tx.setSigners(owner.publicKey().solanaKey());
    owner.kp.secret();
    tx.sign(new solanaweb3.Account(owner.secretKey()));

    const historyItem = createHistoryItem({
        transactionId: Buffer.from('someid'),
        cursor: undefined,
        stellarTxEnvelope: undefined,
        solanaTx: tx.serialize(),
        payments: [
            {
                source: account1.publicKey(),
                destination: account2.publicKey(),
                amount: new BigNumber(10),
            },
            {
                source: account2.publicKey(),
                destination: account1.publicKey(),
                amount: new BigNumber(15),
            },
        ],
        invoices: [],
    });

    const txData = txDataFromProto(historyItem, txpb.GetTransactionResponse.State.SUCCESS);
    expect(txData.txId).toEqual(Buffer.from('someid'));
    expect(txData.txState).toEqual(TransactionState.Success);
    expect(txData.payments).toHaveLength(2);

    expect(txData.payments[0].sender.buffer).toEqual(account1.kp.rawPublicKey());
    expect(txData.payments[0].destination.buffer).toEqual(account2.kp.rawPublicKey());
    expect(txData.payments[0].type).toEqual(TransactionType.P2P);
    expect(txData.payments[0].quarks).toEqual("10");
    expect(txData.payments[0].invoice).toBeUndefined();
    expect(txData.payments[0].memo).toBeUndefined();

    expect(txData.payments[1].sender.buffer).toEqual(account2.kp.rawPublicKey());
    expect(txData.payments[1].destination.buffer).toEqual(account1.kp.rawPublicKey());
    expect(txData.payments[1].type).toEqual(TransactionType.P2P);
    expect(txData.payments[1].quarks).toEqual("15");
    expect(txData.payments[1].invoice).toBeUndefined();
    expect(txData.payments[1].memo).toBeUndefined();
});

test("txDataFromProto invoice payment count mismatch", () => {
    const account1 = PrivateKey.random();
    const account2 = PrivateKey.random();
    const owner = PrivateKey.random();
    const tokenProgram = PrivateKey.random().publicKey().solanaKey();
    const recentBlockhash = new solanaweb3.Account().publicKey.toBase58();
    const invoices = [
        {
            Items: [
                {
                    title: "t1",
                    description: "d2",
                    amount: new BigNumber(10),
                },
            ]
        },
    ];

    const serializedInvoiceList = createInvoiceList({ invoices: invoices }).serializeBinary();
    const fk = Buffer.from(hash.sha224().update(serializedInvoiceList).digest('hex'), "hex");
    const kinMemo = Memo.new(1, TransactionType.P2P, 0, fk);
    const tx = new solanaweb3.Transaction({ 
        feePayer: owner.publicKey().solanaKey(),
        recentBlockhash: recentBlockhash,
     }).add(
        MemoProgram.memo({ data: kinMemo.buffer.toString('base64') }),
        TokenProgram.transfer({
            source: account1.publicKey().solanaKey(),
            dest: account2.publicKey().solanaKey(),
            owner: owner.publicKey().solanaKey(),
            amount: BigInt(10),
        }, tokenProgram),
        TokenProgram.transfer({
            source: account2.publicKey().solanaKey(),
            dest: account1.publicKey().solanaKey(),
            owner: owner.publicKey().solanaKey(),
            amount: BigInt(15),
        }, tokenProgram),
    );
    tx.setSigners(owner.publicKey().solanaKey());
    owner.kp.secret();
    tx.sign(new solanaweb3.Account(owner.secretKey()));

    const historyItem = createHistoryItem({
        transactionId: Buffer.from('someid'),
        cursor: undefined,
        stellarTxEnvelope: undefined,
        solanaTx: tx.serialize(),
        payments: [
            {
                source: account1.publicKey(),
                destination: account2.publicKey(),
                amount: new BigNumber(10),
            },
            {
                source: account2.publicKey(),
                destination: account1.publicKey(),
                amount: new BigNumber(15),
            },
        ],
        invoices: invoices,
    });

    try {
        txDataFromProto(historyItem, txpb.GetTransactionResponse.State.SUCCESS);
        fail();
    } catch (err) {
        expect(err.stack).toContain("number of invoices");
    }
});
