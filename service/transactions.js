const mongoose = require('mongoose');

const { knownCustomers, connectionOptions, dbURL } = require('../config.json');
const TransactionModel = require('../models/transactions');

/**
 * Throw error when invoked
 * @param {String} error
 */
const _throw = (error) => {
  throw new Error(error);
};

/**
 * Establish connection with database
 * @param {Connection} db
 * @returns {Promise}
 */
const _connectToDb = (db) => {
  return new Promise((resolve) => {
    db.on('error', _throw);
    db.once('open', resolve);
  });
};

/**
 * Add Transactions to the Database as a batch query
 * @param {Model} txModel
 * @param {Array} transactions
 * @returns {Promise}
 */
const _executeBatchUpdate = (txModel, transactions) => {
  return new Promise((resolve) => {
    txModel.collection.drop();
    const batch = txModel.collection.initializeOrderedBulkOp();

    transactions.forEach((tx) => {
      const { txid, vout } = tx;
      batch.find({ txid, vout }).upsert().updateOne(tx);
    });

    batch.execute((error, res) => {
      if (error) _throw(error);
      resolve(res);
    });
  });
};

/**
 * Returns aggregate query over valid transactions
 * @returns {Promise}
 */
const _aggregateValidDeposits = () => {
  return TransactionModel.aggregate([
    {
      $match: {
        confirmations: { $gte: 6 },
        $or: [{ category: 'receive' }, { category: 'generate' }],
      },
    },
    {
      $group: {
        _id: '$address',
        count: { $sum: 1 },
        sum: { $sum: '$amount' },
      },
    },
  ]).exec();
};

const _findMinMax = () => {
  return TransactionModel.aggregate([
    {
      $match: {
        confirmations: { $gte: 6 },
        $or: [{ category: 'receive' }, { category: 'generate' }],
      },
    },
    {
      $group: {
        _id: null,
        max: { $max: '$amount' },
        min: { $min: '$amount' },
      },
    },
  ]).exec();
};

/**
 * Save data to mongodb then query and process results
 * @param {Array} transactions
 * @returns {Promise}
 */
const processTransactions = async (transactions) => {
  try {
    mongoose.connect(dbURL, connectionOptions).catch(console.error);
    const db = mongoose.connection;
    mongoose.Promise = global.Promise;

    await _connectToDb(db);
    // Initialize collection with the first document
    const initTx = new TransactionModel(transactions[0]);
    await initTx.save();

    // execute batch update
    await _executeBatchUpdate(TransactionModel, transactions);

    // run aggregation pipeline
    let response = await _aggregateValidDeposits();
    const [{ min, max }] = await _findMinMax();
    response.min = min;
    response.max = max;
    db.close();

    return response;
  } catch (error) {
    console.error(error);
  }
};

/**
 * Process database response and print data in required format
 * @param {Array} accountTxSummary
 */
const displayDepositInfo = async (accountTxSummary) => {
  const txsForUnkownAccounts = accountTxSummary.reduce(
    (account, current) => {
      if (!knownCustomers[current._id]) {
        account.sum += current.sum;
        account.count += current.count;
      }
      return account;
    },
    { count: 0, sum: 0 }
  );

  const txsForKnownAccounts = accountTxSummary.filter(
    (transaction) => knownCustomers[transaction._id]
  );

  const maxAmount = accountTxSummary.max;
  const minAmount = accountTxSummary.min;

  for (let address in knownCustomers) {
    const name = knownCustomers[address];
    const knownCustomerTransaction = txsForKnownAccounts.find((transaction) => {
      return transaction._id === address;
    });
    if (knownCustomerTransaction) {
      const { sum, count } = knownCustomerTransaction;
      console.log(`Deposited for ${name}: count=${count} sum=${parseFloat(sum).toFixed(8)}`);
    }
  }

  const { sum, count } = txsForUnkownAccounts;
  console.log(`Deposited without reference: count=${count} sum=${parseFloat(sum).toFixed(8)}`);
  console.log(`Smallest valid deposit: ${parseFloat(minAmount).toFixed(8)}`);
  console.log(`Largest valid deposit: ${parseFloat(maxAmount).toFixed(8)}`);
};

module.exports = { processTransactions, displayDepositInfo };
