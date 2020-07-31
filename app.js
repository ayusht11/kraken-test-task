const fs = require('fs');
const { tx1Path, tx2Path } = require('./config.json');
const { processTransactions, displayDepositInfo } = require('./service/transactions');

/**
 * Reads tx json file and returns the Transactions
 * @param {String} filePath
 * @returns {Object}
 */
const readTransactions = (filePath) => {
  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);

    try {
      const data = JSON.parse(buffer);
      return data.transactions;
    } catch (error) {
      console.error('Error: Failed to parse transaction file', error);
    }
  }
};

const transaction1 = readTransactions(tx1Path);
const transaction2 = readTransactions(tx2Path);
const transactions = transaction1.concat(transaction2);

processTransactions(transactions).then(displayDepositInfo);
