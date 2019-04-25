const fs = require('fs');
const Web3 = require('web3');
var Writable = require('stream').Writable;
const readline = require('readline');
const EthereumTx = require('ethereumjs-tx');
const EthereumUtil = require('ethereumjs-util');
const solc = require('solc');
const keythereum = require('keythereum');

const web3 = new Web3(new Web3.providers.HttpProvider(process.env.PROVIDER_URL));

async function compile(dir, contractName, contractCode) {
	console.log(`  ${contractName} compile...`);
	const compiled = solc.compile({
		sources: {
			'': (contractCode ? contractCode : fs.readFileSync(dir + contractName + '.sol').toString())
		}
	}, 1, function (path) {
		let content;
		try {
			content = fs.readFileSync(dir + path);
		} catch (e) {
			if (e.code == 'ENOENT') {
				content = fs.readFileSync(dir + '../' + path);
			}
		}
		return {
			contents: content.toString()
		}
	});
	const abi = JSON.parse(compiled.contracts[':' + contractName].interface);
	const bytecode = compiled.contracts[':' + contractName].bytecode;
	return {abi: abi, bytecode: bytecode};
}

async function deploy(contractName, contractSpec, sender, key, chainId, args) {
	console.log(`  ${contractName} deploy...`);
	const contract = new web3.eth.Contract(contractSpec.abi);
	const dep = await contract.deploy({data: '0x' + contractSpec.bytecode, arguments: args});
	return (await call(dep, sender, '', key, chainId)).contractAddress;
}

async function call(method, from, to, key, chainId) {
	const gasPrice = web3.utils.toWei('1', 'gwei');

	for (let i = 0; i < 5; i++) {
		try {
			const estimateGas = await method.estimateGas({
				from: from,
				gas: web3.utils.toHex(4700000)
			});

			const nonce = await web3.eth.getTransactionCount(from);
			const nonceHex = web3.utils.toHex(nonce);
			const data = await method.encodeABI();
			
			var tx = new EthereumTx({
				nonce: nonceHex,
				gasPrice: web3.utils.toHex(gasPrice),
				gasLimit: web3.utils.toHex(estimateGas),
				to: to,
				value: '0x00',
				data: data,
				chainId: chainId
			});
			
			tx.sign(key);

			const serializedTx = tx.serialize();

			const result = await web3.eth.sendSignedTransaction("0x" + serializedTx.toString('hex'));

			if (result.status !== true) {
				throw new Error("transaction status is false");
			}

			return result;
		} catch (e) {
			if (e.message.indexOf('nonce is too low') >= 0 || e.message.indexOf('price is too low') >= 0) {
				console.log('  Transaction failed. Another try in 5 seconds...');
				await sleep(5000);
				continue;
			} else {
				throw e;
			}
		}
	}
}

async function send(from, to, key, chainId) {
	const gasPrice = web3.utils.toWei('1', 'gwei');

	for (let i = 0; i < 5; i++) {
		try {
			const nonce = await web3.eth.getTransactionCount(from);
			const nonceHex = web3.utils.toHex(nonce);
			
			var tx = new EthereumTx({
				nonce: nonceHex,
				gasPrice: web3.utils.toHex(gasPrice),
				gasLimit: web3.utils.toHex('22000'),
				to: to,
				value: web3.utils.toHex(web3.utils.toWei('300000', 'gwei')),
				data: '0x00',
				chainId: chainId
			});
			
			tx.sign(key);

			const serializedTx = tx.serialize();

			const result = await web3.eth.sendSignedTransaction("0x" + serializedTx.toString('hex'));

			if (result.status !== true) {
				throw new Error("transaction status is false");
			}

			return result;
		} catch (e) {
			if (e.message.indexOf('nonce is too low') >= 0 || e.message.indexOf('price is too low') >= 0) {
				console.log('  Transaction failed. Another try in 5 seconds...');
				await sleep(5000);
				continue;
			} else {
				throw e;
			}
		}
	}
}

async function readPrivateKey() {
	return new Promise((resolve, reject) => {
		var mutableStdout = new Writable({
			write: function(chunk, encoding, callback) {
				if (!this.muted) {
					process.stdout.write(chunk, encoding);
				}
				callback();
			}
		});
		
		mutableStdout.muted = false;
		
		const readlineInterface = readline.createInterface({
			input: process.stdin,
			output: mutableStdout,
			terminal: true
		});

		readlineInterface.question('Enter key password: ', (pwd) => {
			readlineInterface.close();
			console.log('');
			console.log('');

			const keystore = require(process.cwd() + '/keystore/moc.json');
			const mocAddress = `0x${keystore.address}`;
			const privateKey = keythereum.recover(pwd, keystore).toString('hex');

			resolve({privateKey, mocAddress});
		});
		
		mutableStdout.muted = true;
	});
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
	compile,
	deploy,
	call,
	send,
	readPrivateKey,
	sleep
}