const { ethers } = require("ethers");
require('dotenv').config()
const {
  cEthAbi,
  comptrollerAbi,
  priceFeedAbi,
  cErcAbi,
  erc20Abi,
} = require('./ABI/contracts.json');
const provider = new ethers.providers.JsonRpcProvider("https://goerli.infura.io/v3/ef71c66160a24ee2995edc9d72d8407f");

const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const myWalletAddress = '0x8522532C32716F244f5Dff45125d4d265f89920B';

const cEthAddress = '0x20572e4c090f15667cf7378e16fad2ea0e2f3eff';
const cEth = new ethers.Contract(cEthAddress,cEthAbi,signer );
// const ceth = cEth.connect(signer);


const comptrollerAddress = '0x627ea49279fd0de89186a58b8758ad02b6be2867';
const comptroller = new ethers.Contract(comptrollerAddress,comptrollerAbi,signer );

// mainnet Contract for the Open Price Feed
// const priceFeedAddress = '0x922018674c12a7f0d394ebeef9b58f186cde13c1';
// const priceFeed = new ethers.Contract(priceFeedAddress,priceFeedAbi,signer );
const priceFeed=0.9995;//DAI to USD price

// Goerli address of underlying token (like DAI or USDC)
const underlyingAddress = '0x5c221e77624690fff6dd741493d735a17716c26b'; // Dai
const underlying = new ethers.Contract(underlyingAddress,erc20Abi,signer );

// Goerli address for a cToken (like cDai, https://compound.finance/docs#networks)
const cTokenAddress = '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643'; // cDai
const cToken = new ethers.Contract(cTokenAddress,cErcAbi,);
const assetName = 'DAI'; // for the log output lines
const underlyingDecimals = 18; // Number of decimals defined in this ERC20 token's contract
const logBalances = () => {
  return new Promise(async (resolve, reject) => {
    let myWalletEthBalance = await provider.getBalance(myWalletAddress)
   
    let myWalletCEthBalance = await cEth.balanceOf(myWalletAddress) / 1e8;
    let myWalletUnderlyingBalance = +await underlying.balanceOf(myWalletAddress) / Math.pow(10, underlyingDecimals);

    console.log("My Wallet's  ETH Balance:",  ethers.utils.formatEther(myWalletEthBalance));
    console.log("My Wallet's cETH Balance:", myWalletCEthBalance);
    console.log(`My Wallet's  ${assetName} Balance:`, myWalletUnderlyingBalance);

    resolve();
  });
};



const main = async () => {
  await logBalances();
  const gasPrice =await provider.getGasPrice();
  const ethToSupplyAsCollateral = 0.001;

  console.log('\nSupplying ETH to the protocol as collateral (you will get cETH in return)...\n');
  let mint = await cEth.mint({
    gasLimit: ethers.BigNumber.from(150).toHexString(),
    gasPrice: gasPrice.toHexString(),
    value: (ethToSupplyAsCollateral * 1e18).toString()
  });
  await logBalances();

  console.log('\nEntering market (via Comptroller contract) for ETH (as collateral)...');
  let markets = [ cEthAddress ]; // This is the cToken contract(s) for your collateral
  let enterMarkets = await comptroller.enterMarkets(markets);
  await enterMarkets.wait(1);

  console.log('Calculating your liquid assets in the protocol...');
  let { 1:liquidity } = await comptroller.callStatic.getAccountLiquidity(myWalletAddress);
  liquidity = liquidity / 1e18;

  console.log('Fetching cETH collateral factor...');
  let { 1:collateralFactor } = await comptroller.callStatic.markets(cEthAddress);
  collateralFactor = (collateralFactor / 1e18) * 100; // Convert to percent

  console.log(`Fetching ${assetName} price from the price feed...`);
  let underlyingPriceInUsd = await priceFeed.callStatic.price(assetName);
  underlyingPriceInUsd = underlyingPriceInUsd / 1e6; // Price feed provides price in USD with 6 decimal places

  console.log(`Fetching borrow rate per block for ${assetName} borrowing...`);
  let borrowRate = await cToken.callStatic.borrowRatePerBlock();
  borrowRate = borrowRate / Math.pow(10, underlyingDecimals);

  console.log(`\nYou have ${liquidity} of LIQUID assets (worth of USD) pooled in the protocol.`);
  console.log(`You can borrow up to ${collateralFactor}% of your TOTAL collateral supplied to the protocol as ${assetName}.`);
  console.log(`1 ${assetName} == ${underlyingPriceInUsd.toFixed(6)} USD`);
  console.log(`You can borrow up to ${liquidity/underlyingPriceInUsd} ${assetName} from the protocol.`);
  console.log(`NEVER borrow near the maximum amount because your account will be instantly liquidated.`);
  console.log(`\nYour borrowed amount INCREASES (${borrowRate} * borrowed amount) ${assetName} per block.\nThis is based on the current borrow rate.\n`);

  const underlyingToBorrow = 50;
  console.log(`Now attempting to borrow ${underlyingToBorrow} ${assetName}...`);
  const scaledUpBorrowAmount = (underlyingToBorrow * Math.pow(10, underlyingDecimals)).toString();
  const trx = await cToken.borrow(scaledUpBorrowAmount);
  await trx.wait(1);
  // console.log('Borrow Transaction', trx);

  await logBalances();

  console.log(`\nFetching ${assetName} borrow balance from c${assetName} contract...`);
  let balance = await cToken.callStatic.borrowBalanceCurrent(myWalletAddress);
  balance = balance / Math.pow(10, underlyingDecimals);
  console.log(`Borrow balance is ${balance} ${assetName}`);

  console.log(`\nThis part is when you do something with those borrowed assets!\n`);

};
  
main().catch((err) => {
  console.error('ERROR:', err);
});
