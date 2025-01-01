const { Connection, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class SonicRingCalculator {
    constructor() {
        this.DEVNET_ENDPOINT = 'https://devnet.sonic.game';
        this.TESTNET_ENDPOINT = 'https://api.testnet.v0.sonic.game';
        this.DEVNET_TOKEN = '8DihuwAUQ9CAU8U2pQ5Rv7FzpsGaZmbwK9Ln6fStdSeo';
        this.TESTNET_TOKEN = 'EaVyvc1xw2wsZV3en6HaSx5B3ebuANXfrFekzX7zZzVm';
        
        // Initialize connections with new RPCs
        this.devnetConnection = new Connection(this.DEVNET_ENDPOINT, 'confirmed');
        this.testnetConnection = new Connection(this.TESTNET_ENDPOINT, 'confirmed');
    }

    async fetchTokenInfo(chainId, tokenAddress) {
        const url = `https://token-list-api.solana.cloud/v1/mints?chainId=${chainId}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                addresses: [tokenAddress]
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch token info for chain ${chainId}`);
        }

        return await response.json();
    }

    async getTokenBalance(connection, walletAddress, tokenMintAddress) {
        try {
            const wallet = new PublicKey(walletAddress);
            const mint = new PublicKey(tokenMintAddress);
            
            // Get the associated token account address
            const associatedTokenAddress = await getAssociatedTokenAddress(
                mint,
                wallet,
                false,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );
    
            try {
                const tokenAccountInfo = await connection.getTokenAccountBalance(associatedTokenAddress);
                return {
                    amount: tokenAccountInfo.value.amount,
                    decimals: tokenAccountInfo.value.decimals,
                    uiAmount: tokenAccountInfo.value.uiAmount
                };
            } catch (err) {
                const errorMessage = err.message.includes('account not found')
                    ? 'No token account found'
                    : err.message;
                console.error(chalk.gray(`Info: ${chalk.yellow(walletAddress)}: ${errorMessage}`));
                return {
                    amount: '0',
                    decimals: 0,
                    uiAmount: 0
                };
            }
        } catch (error) {
            console.error(chalk.red(`Error getting token balance for ${chalk.yellow(walletAddress)}: ${error.message}`));
            return {
                amount: '0',
                decimals: 0,
                uiAmount: 0
            };
        }
    }    

    async calculateTotalBalance(walletAddress) {
        try {
            // Validate wallet address
            new PublicKey(walletAddress);

            // Get Devnet balance
            const devnetBalance = await this.getTokenBalance(
                this.devnetConnection,
                walletAddress,
                this.DEVNET_TOKEN
            );

            // Get Testnet balance
            const testnetBalance = await this.getTokenBalance(
                this.testnetConnection,
                walletAddress,
                this.TESTNET_TOKEN
            );

            // Fetch token information
            const devnetTokenInfo = await this.fetchTokenInfo(103, this.DEVNET_TOKEN);
            const testnetTokenInfo = await this.fetchTokenInfo(102, this.TESTNET_TOKEN);

            const result = {
                address: walletAddress,
                devnet: {
                    balance: devnetBalance.uiAmount,
                    tokenInfo: devnetTokenInfo
                },
                testnet: {
                    balance: testnetBalance.uiAmount,
                    tokenInfo: testnetTokenInfo
                },
                totalBalance: devnetBalance.uiAmount + testnetBalance.uiAmount
            };

            return result;
        } catch (error) {
            console.error(chalk.red(`Error calculating total balance for ${chalk.yellow(walletAddress)}: ${error.message}`));
            return {
                address: walletAddress,
                error: error.message,
                devnet: { balance: 0 },
                testnet: { balance: 0 },
                totalBalance: 0
            };
        }
    }

    async processAddressFile(filePath) {
        try {
            // Read and parse the addresses file
            const fileContent = await fs.readFile(filePath, 'utf8');
            const addresses = fileContent
                .split('\n')
                .map(addr => addr.trim())
                .filter(addr => addr.length > 0);

            console.log(chalk.cyan('\n🔍 Processing ') + chalk.yellow(addresses.length) + chalk.cyan(' addresses...\n'));

            // Process addresses with rate limiting
            const results = [];
            const BATCH_SIZE = 5;
            
            for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
                const batch = addresses.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.all(
                    batch.map(async (address) => {
                        const result = await this.calculateTotalBalance(address);
                        return result;
                    })
                );
                results.push(...batchResults);
                
                // Show progress
                console.log(chalk.cyan(`Progress: ${chalk.yellow(Math.min(i + BATCH_SIZE, addresses.length))}/${chalk.yellow(addresses.length)} addresses processed`));
                
                // Add delay between batches
                if (i + BATCH_SIZE < addresses.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // Calculate grand total
            const grandTotal = results.reduce((sum, result) => sum + result.totalBalance, 0);

            // Generate summary
            const summary = {
                totalAddresses: addresses.length,
                successfulQueries: results.filter(r => !r.error).length,
                failedQueries: results.filter(r => r.error).length,
                grandTotal,
                details: results
            };

            // Save results to a file
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const outputPath = path.join(process.cwd(), `balance-report-${timestamp}.json`);
            await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));

            return summary;
        } catch (error) {
            console.error(chalk.red('Error processing address file:', error));
            throw error;
        }
    }
}

// Example usage:
async function main() {
    const calculator = new SonicRingCalculator();
    
    try {
        const addressFilePath = path.join(process.cwd(), 'addresses.txt');
        const summary = await calculator.processAddressFile(addressFilePath);
        
        console.log(chalk.bold('\n📊 Sonic SVM Devnet + Testnet Balance Summary'));
        console.log(chalk.bold('\nCreated by: https://github.com/rmndkyl'));
        console.log(chalk.gray('================'));
        console.log(chalk.blue(`📫 Total Addresses: ${chalk.yellow(summary.totalAddresses)}`));
        console.log(chalk.green(`✅ Successful Queries: ${chalk.yellow(summary.successfulQueries)}`));
        console.log(chalk.red(`❌ Failed Queries: ${chalk.yellow(summary.failedQueries)}`));
        console.log(chalk.magenta(`💰 Grand Total Balance: ${chalk.yellow(summary.grandTotal.toLocaleString())}`));
        console.log(chalk.gray(`\n💾 Report saved to: ${chalk.cyan(`balance-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)}`));
        
        // Display individual balances
        console.log(chalk.bold('\n📝 Individual Balances'));
        console.log(chalk.gray('==================='));
        summary.details.forEach(result => {
            if (result.error) {
                console.log(chalk.red(`${result.address}: Error - ${result.error}`));
            } else {
                console.log(
                    `${chalk.cyan(result.address)}: ` +
                    `Total=${chalk.yellow(result.totalBalance.toLocaleString())} ` +
                    `(${chalk.green(`Devnet=${result.devnet.balance.toLocaleString()}`)}` +
                    `, ${chalk.blue(`Testnet=${result.testnet.balance.toLocaleString()}`)})`
                );
            }
        });
    } catch (error) {
        console.error(chalk.red('Failed to process addresses:', error));
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

// Export the calculator class
module.exports = SonicRingCalculator;