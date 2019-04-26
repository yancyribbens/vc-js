const chai = require('chai');
const constants = require('./constants');
const {Ed25519KeyPair} = require('crypto-ld');
const jsigs = require('jsonld-signatures');
const jsonld = require('jsonld');
const mockData = require('./mock.data');
const uuid = require('uuid/v4');
const vc = require('..');
const MultiLoader = require('./MultiLoader');
const realContexts = require('../lib/contexts');
const invalidContexts = require('./contexts');
const credential = require('./mocks/credential');
const assertionController = require('./mocks/assertionController');

chai.should();
const {expect} = chai;

const contexts = Object.assign({}, realContexts);

const testContextLoader = () => {
  // FIXME: used credentials-context module when available
  for(const key in invalidContexts) {
    const {url, value} = invalidContexts[key];
    contexts[url] = value;
  }
  return async url => {
    if(!contexts[url]) {
      throw new Error('NotFoundError');
    }
    return {
      contextUrl: null,
      document: jsonld.clone(contexts[url]),
      documentUrl: url
    };
  };
};

// documents are added to this documentLoader incrementally
const testLoader = new MultiLoader({
  documentLoader: [
    // CREDENTIALS_CONTEXT_URL
    testContextLoader(),
  ]
});

const documentLoader = testLoader.documentLoader.bind(testLoader);

let suite, keyPair, verifiedCredential;

before(async () => {
  // Set up the key that will be signing and verifying
  keyPair = await Ed25519KeyPair.generate({
    id: 'https://example.edu/issuers/keys/1',
    controller: 'https://example.com/i/carol'
  });
  // Register the controller document and the key document with documentLoader
  contexts['https://example.com/i/carol'] = assertionController;
  contexts['https://example.edu/issuers/keys/1'] = keyPair.publicNode();

  // Add the key to the Controller doc (authorizes its use for assertion)
  assertionController.assertionMethod.push(keyPair.id);

  // Set up the signature suite, using the generated key
  suite = new jsigs.suites.Ed25519Signature2018({
    verificationMethod: 'https://example.edu/issuers/keys/1',
    key: keyPair
  });
});

describe('vc.issue()', () => {
  it('should issue a verifiable credential with proof', async () => {
    verifiedCredential = await vc.issue({credential, suite});
    verifiedCredential.proof.should.exist;
  });
});

describe('vc.verify()', () => {
  it('should verify a vc', async () => {
    const result = await vc.verify(
      {credential: verifiedCredential, suite, documentLoader});
    result.verified.should.be.true;
    expect(result.error).to.not.exist;
  });
});

describe('verify API', () => {
  it.skip('verifies a valid presentation', async () => {
    const challenge = uuid();
    const domain = uuid();
    const {AuthenticationProofPurpose} = jsigs.purposes;
    const {presentation, suite} = await _generatePresentation(
      {challenge, domain});
    const result = await vc.verifyPresentation({
      challenge,
      suite,
      documentLoader,
      purpose: new AuthenticationProofPurpose({challenge, domain}),
      domain,
      presentation
    });
    result.presentationResult.verified.should.be.a('boolean');
    result.presentationResult.verified.should.be.true;
    result.verified.should.be.a('boolean');
    result.verified.should.be.true;
  });
  it.skip('verifies a valid credential', async () => {
    const {credential, suite} = await _generateCredential();
    const result = await vc.verify({
      suite,
      credential,
      documentLoader
    });
    result.verified.should.be.a('boolean');
    result.verified.should.be.true;
  });

  describe('negative tests', async () => {
    it('fails to verify if a context is null', async () => {
      const {credential, suite} = await _generateCredential();
      credential['@context'].push(invalidContexts.nullDoc.url);
      const result = await vc.verify({
        suite,
        credential,
        documentLoader
      });
      result.verified.should.be.a('boolean');
      result.verified.should.be.false;
      result.error.name.should.contain('jsonld.InvalidUrl');
    });
    it('fails to verify if a context contains an invalid id', async () => {
      const {credential, suite} = await _generateCredential();
      credential['@context'].push(invalidContexts.invalidId.url);
      const result = await vc.verify({
        suite,
        credential,
        documentLoader
      });
      result.verified.should.be.a('boolean');
      result.verified.should.be.false;
      result.error.name.should.contain('jsonld.SyntaxError');
    });
    it('fails to verify if a context has a null version', async () => {
      const {credential, suite} = await _generateCredential();
      credential['@context'].push(invalidContexts.nullVersion.url);
      const result = await vc.verify({
        suite,
        credential,
        documentLoader
      });
      result.verified.should.be.a('boolean');
      result.verified.should.be.false;
      result.error.name.should.contain('jsonld.UnsupportedVersion');
    });
    it('fails to verify if a context has a null @id', async () => {
      const {credential, suite} = await _generateCredential();
      credential['@context'].push(invalidContexts.nullId.url);
      const result = await vc.verify({
        suite,
        credential,
        documentLoader
      });
      result.verified.should.be.a('boolean');
      result.verified.should.be.false;
      result.error.name.should.contain('jsonld.SyntaxError');
    });
    it('fails to verify if a context has a null @type', async () => {
      const {credential, suite} = await _generateCredential();
      credential['@context'].push(invalidContexts.nullType.url);
      const result = await vc.verify({
        suite,
        credential,
        documentLoader
      });
      result.verified.should.be.a('boolean');
      result.verified.should.be.false;
      result.error.name.should.contain('jsonld.SyntaxError');
    });
    it('fails to verify if a context links to a missing doc', async () => {
      const {credential, suite} = await _generateCredential();
      credential['@context'].push('https://fsad.digitalbazaar.com');
      const result = await vc.verify({
        suite,
        credential,
        documentLoader
      });
      result.verified.should.be.a('boolean');
      result.verified.should.be.false;
      result.error.name.should.contain('jsonld.InvalidUrl');
    });
    it('fails to verify if a context has an invalid url', async () => {
      const {credential, suite} = await _generateCredential();
      credential['@context'].push('htps://fsad.digitalbazaar.');
      const result = await vc.verify({
        suite,
        credential,
        documentLoader
      });
      result.verified.should.be.a('boolean');
      result.verified.should.be.false;
      result.error.name.should.contain('jsonld.InvalidUrl');
    });
  });
});

function _generateKeyId({did, key}) {
  // `did` + multibase base58 (0x7a / z) encoding + key fingerprint
  return `${did}#z${key.fingerprint()}`;
}

async function _generateCredential() {
  const mockCredential = jsonld.clone(mockData.credentials.alpha);
  const {authenticationKey, documentLoader} = await _generateDid();
  const {Ed25519Signature2018} = jsigs.suites;
  const {AuthenticationProofPurpose} = jsigs.purposes;
  testLoader.addLoader(documentLoader);
  const suite = new Ed25519Signature2018({key: authenticationKey});
  const credential = await jsigs.sign(mockCredential, {
    compactProof: false,
    documentLoader: testLoader.documentLoader.bind(testLoader),
    suite,
    purpose: new AuthenticationProofPurpose({
      challenge: 'challengeString'
    })
  });
  return {credential, documentLoader, suite};
}

async function _generatePresentation({challenge, domain}) {
  const mockPresentation = jsonld.clone(mockData.presentations.alpha);
  const {authenticationKey, documentLoader: dlp} = await _generateDid();
  testLoader.addLoader(dlp);
  const {Ed25519Signature2018} = jsigs.suites;
  const {AuthenticationProofPurpose} = jsigs.purposes;
  const {credential, documentLoader: dlc} = await _generateCredential();
  testLoader.addLoader(dlc);
  mockPresentation.verifiableCredential.push(credential);
  const suite = new Ed25519Signature2018({key: authenticationKey});
  const presentation = await jsigs.sign(mockPresentation, {
    compactProof: false,
    documentLoader,
    suite,
    purpose: new AuthenticationProofPurpose({challenge, domain})
  });
  return {presentation, suite};
}

async function _generateDid() {
  const mockDoc = jsonld.util.clone(mockData.privateDidDocuments.alpha);
  const capabilityInvocationKey = await Ed25519KeyPair.generate();
  const keyFingerprint = `z${capabilityInvocationKey.fingerprint()}`;

  const did = `did:v1:test:nym:${keyFingerprint}`;
  // cryptonym dids are based on fingerprint of capabilityInvokation key
  mockDoc.id = did;
  capabilityInvocationKey.id = _generateKeyId(
    {did, key: capabilityInvocationKey});
  const controller = did;
  capabilityInvocationKey.controller = controller;
  mockDoc.capabilityInvocation[0] = {
    id: capabilityInvocationKey.id,
    type: capabilityInvocationKey.type,
    controller: capabilityInvocationKey.controller,
    publicKeyBase58: capabilityInvocationKey.publicKeyBase58
  };
  const authenticationKey = await Ed25519KeyPair.generate();
  authenticationKey.id = _generateKeyId(
    {did, key: authenticationKey});
  authenticationKey.controller = controller;
  mockDoc.authentication[0] = {
    id: authenticationKey.id,
    type: authenticationKey.type,
    controller: authenticationKey.controller,
    publicKeyBase58: authenticationKey.publicKeyBase58
  };
  const documentLoader = await _createDidDocumentLoader({record: mockDoc});
  return {
    authenticationKey, did, documentLoader, mockDoc, capabilityInvocationKey
  };
}

// delimiters for a DID URL
const splitRegex = /[;|\/|\?|#]/;
// all the keys extracted using the document loader are restricted by the
// `basisBlockHeight` of the operation being validated. This ensures that
// the signatures were valid at the time of signing.
async function _createDidDocumentLoader({record}) {
  return async function(url) {
    if(!url.startsWith('did:')) {
      throw new Error('NotFoundError');
    }
    const [did] = url.split(splitRegex);
    if(did !== record.id) {
      throw new Error('NotFoundError');
    }
    const didDocument = jsonld.util.clone(record);
    if(!url.includes('#')) {
      return {
        contextUrl: null,
        document: didDocument,
        documentUrl: url
      };
    }
    // try to find the specific object in the DID document
    const document = await _pluckDidNode(did, url, didDocument);
    return {
      contextUrl: null,
      document,
      documentUrl: url
    };
  };
}

async function _pluckDidNode(did, target, didDocument) {
  // flatten to isolate target
  jsonld.documentLoader = documentLoader;
  const flattened = await jsonld.flatten(didDocument);
  // filter out non-DID nodes and find target
  let found = false;
  const filtered = [];
  for(const node of flattened) {
    const id = node['@id'];
    if(id === target) {
      filtered.push(node);
      found = true;
      break;
    }
  }
  // target not found
  if(!found) {
    const err = new Error('Not Found');
    err.httpStatusCode = 404;
    err.status = 404;
    throw err;
  }

  const context = [
    constants.DID_CONTEXT_URL,
    constants.VERES_ONE_CONTEXT_URL
  ];
  // frame target
  const framed = await jsonld.frame(
    filtered, {'@context': context, id: target}, {embed: '@always'});

  return Object.assign({'@context': context}, framed['@graph'][0]);
}
