var fs = require('fs');
var PoaNetworkConsensus = artifacts.require("./PoaNetworkConsensus.sol");
var ProxyStorage = artifacts.require("./ProxyStorage.sol");
var ProxyStorageEternalStorage = artifacts.require("./eternal-storage/EternalStorageProxy.sol");
var KeysManager = artifacts.require("./KeysManager.sol");
var BallotsStorage = artifacts.require("./BallotsStorage.sol");
var BallotsStorageEternalStorage = artifacts.require("./eternal-storage/EternalStorageProxy.sol");
var ValidatorMetadata = artifacts.require("./ValidatorMetadata.sol");
var ValidatorMetadataEternalStorage = artifacts.require("./eternal-storage/EternalStorageProxy.sol");
let VotingToChangeKeys = artifacts.require("./VotingToChangeKeys");
let VotingToChangeKeysEternalStorage = artifacts.require("./eternal-storage/EternalStorageProxy.sol");
let VotingToChangeMinThreshold = artifacts.require("./VotingToChangeMinThreshold");
let VotingToChangeMinThresholdEternalStorage = artifacts.require("./eternal-storage/EternalStorageProxy.sol");
let VotingToChangeProxyAddress = artifacts.require("./VotingToChangeProxyAddress");

module.exports = async function(deployer, network, accounts) {
  let masterOfCeremony = process.env.MASTER_OF_CEREMONY;
  let poaNetworkConsensusAddress = process.env.POA_NETWORK_CONSENSUS_ADDRESS;
  let previousKeysManager = process.env.OLD_KEYSMANAGER || "0x0000000000000000000000000000000000000000";
  let poaNetworkConsensus;
  if (!!process.env.DEPLOY_POA === true && network === 'sokol') {
    poaNetworkConsensus = await PoaNetworkConsensus.at(poaNetworkConsensusAddress);
    let validators = await poaNetworkConsensus.getValidators();
    let moc = validators.indexOf(masterOfCeremony.toLowerCase())
    if (moc > -1) {
      validators.splice(moc, 1);
    }
    poaNetworkConsensus = await deployer.deploy(PoaNetworkConsensus, masterOfCeremony, validators);
    console.log(PoaNetworkConsensus.address)
    poaNetworkConsensusAddress = PoaNetworkConsensus.address
  }
  if (network === 'sokol') {
    let demoMode = !!process.env.DEMO === true;
    try {
      poaNetworkConsensus = poaNetworkConsensus || await PoaNetworkConsensus.at(poaNetworkConsensusAddress);
      
      await deployer.deploy(ProxyStorage);
      await deployer.deploy(ProxyStorageEternalStorage, 0, ProxyStorage.address);
      const proxyStorage = await ProxyStorage.at(ProxyStorageEternalStorage.address);
      await proxyStorage.init(poaNetworkConsensusAddress);
      
      await deployer.deploy(KeysManager, proxyStorage.address, poaNetworkConsensusAddress, masterOfCeremony, previousKeysManager);
      
      await deployer.deploy(BallotsStorage);
      await deployer.deploy(BallotsStorageEternalStorage, proxyStorage.address, BallotsStorage.address);
      const ballotsStorage = await BallotsStorage.at(BallotsStorageEternalStorage.address);
      await ballotsStorage.init(demoMode);
      
      await deployer.deploy(ValidatorMetadata);
      await deployer.deploy(ValidatorMetadataEternalStorage, proxyStorage.address, ValidatorMetadata.address);
      
      await deployer.deploy(VotingToChangeKeys);
      await deployer.deploy(VotingToChangeKeysEternalStorage, proxyStorage.address, VotingToChangeKeys.address);
      const votingToChangeKeys = await VotingToChangeKeys.at(VotingToChangeKeysEternalStorage.address);
      await votingToChangeKeys.init(demoMode);
      
      await deployer.deploy(VotingToChangeMinThreshold);
      await deployer.deploy(VotingToChangeMinThresholdEternalStorage, proxyStorage.address, VotingToChangeMinThreshold.address);
      const votingToChangeMinThreshold = await VotingToChangeMinThreshold.at(VotingToChangeMinThresholdEternalStorage.address);
      await votingToChangeMinThreshold.init(demoMode);

      await deployer.deploy(VotingToChangeProxyAddress, proxyStorage.address, demoMode);

      await proxyStorage.initializeAddresses(
        KeysManager.address,
        VotingToChangeKeysEternalStorage.address,
        VotingToChangeMinThresholdEternalStorage.address,
        VotingToChangeProxyAddress.address,
        BallotsStorageEternalStorage.address,
        ValidatorMetadataEternalStorage.address
      );
      await poaNetworkConsensus.setProxyStorage(proxyStorage.address);

      if (!!process.env.SAVE_TO_FILE === true) {
        let contracts = {
          "VOTING_TO_CHANGE_KEYS_ADDRESS": VotingToChangeKeysEternalStorage.address,
          "VOTING_TO_CHANGE_MIN_THRESHOLD_ADDRESS": VotingToChangeMinThresholdEternalStorage.address,
          "VOTING_TO_CHANGE_PROXY_ADDRESS": VotingToChangeProxyAddress.address,
          "BALLOTS_STORAGE_ADDRESS": BallotsStorageEternalStorage.address,
          "KEYS_MANAGER_ADDRESS": KeysManager.address,
          "METADATA_ADDRESS": ValidatorMetadataEternalStorage.address,
          "PROXY_ADDRESS": ProxyStorageEternalStorage.address
        }

        await saveToFile('./contracts.json', JSON.stringify(contracts, null, 2));
      }

      console.log('Done')
      console.log('ADDRESSES:\n', 
     `VotingToChangeKeys.address (implementation) ${VotingToChangeKeys.address} \n
      VotingToChangeKeys.address (storage) ${VotingToChangeKeysEternalStorage.address} \n
      VotingToChangeMinThreshold.address (implementation) ${VotingToChangeMinThreshold.address} \n
      VotingToChangeMinThreshold.address (storage) ${VotingToChangeMinThresholdEternalStorage.address} \n
      VotingToChangeProxyAddress.address ${VotingToChangeProxyAddress.address} \n
      BallotsStorage.address (implementation) ${BallotsStorage.address} \n
      BallotsStorage.address (storage) ${BallotsStorageEternalStorage.address} \n
      KeysManager.address ${KeysManager.address} \n
      ValidatorMetadata.address (implementation) ${ValidatorMetadata.address} \n
      ValidatorMetadata.address (storage) ${ValidatorMetadataEternalStorage.address} \n
      ProxyStorage.address (implementation) ${ProxyStorage.address} \n
      ProxyStorage.address (storage) ${ProxyStorageEternalStorage.address} \n
      `)
      
    } catch (error) {
      console.error(error);
    }

  }
};

function saveToFile(filename, content) {
  return new Promise((resolve, reject) => {
    fs.writeFile(filename, content, (err) => {
      console.log(err)
      if (err) reject(err);
      resolve();
    });
  });
}

// SAVE_TO_FILE=true POA_NETWORK_CONSENSUS_ADDRESS=0x8bf38d4764929064f2d4d3a56520a76ab3df415b MASTER_OF_CEREMONY=0xCf260eA317555637C55F70e55dbA8D5ad8414Cb0 OLD_KEYSMANAGER=0xfc90125492e58dbfe80c0bfb6a2a759c4f703ca8 ./node_modules/.bin/truffle migrate --reset --network sokol
// SAVE_TO_FILE=true DEPLOY_POA=true POA_NETWORK_CONSENSUS_ADDRESS=0x8bf38d4764929064f2d4d3a56520a76ab3df415b MASTER_OF_CEREMONY=0xCf260eA317555637C55F70e55dbA8D5ad8414Cb0 OLD_KEYSMANAGER=0xfc90125492e58dbfe80c0bfb6a2a759c4f703ca8 ./node_modules/.bin/truffle migrate --reset --network sokol
