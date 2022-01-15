
const express = require('express');
const app = express();


region='us-east-1'

// print process.argv
process.argv.forEach((val, index) => {
  console.log(`${index}: ${val}`)
  if(index == 2) {
    region = val
    console.log(region)
  }
})


// Load the SDK and UUID
var AWS = require('aws-sdk');
var uuid = require('uuid');

var sagemaker = new AWS.SageMaker({apiVersion: '2017-07-24', region: region});
var port = process.env.PORT || 3000



var authurl='';
var authHtml ='';
var paramDomain ='';
var paramProfile ='';

const ssmClient = new AWS.SSM({
  apiVersion: '2014-11-06',
  region: region
});

ssmClient.getParameter({
  Name: '/sagemaker-studio-proxy/dev/studio-domain-name',
  WithDecryption: true,
}, (err, data) => {
  if (data.Parameter) {
    console.log(data.Parameter.Value)
    paramDomain = data.Parameter.Value

  }
});

ssmClient.getParameter({
  Name: '/sagemaker-studio-proxy/dev/studio-user-profile-name',
  WithDecryption: true,
}, (err, data) => {
  if (data.Parameter) {
    console.log(data.Parameter.Value)
    paramProfile = data.Parameter.Value

  }
});




app.get('/', (req, res) => {

  var params = {
    DomainId: paramDomain , /* required */
    UserProfileName: paramProfile, /* required */
    ExpiresInSeconds: '300',
    SessionExpirationDurationInSeconds: '3000'
  };

  console.log(params);



  sagemaker.createPresignedDomainUrl(params, function(err, data) {
    
  if (err) console.log(err, err.stack); // an error occurred
  else   {
    console.log(data);  
    authurl = data.AuthorizedUrl;
    console.log('authurl:' +authurl);
    authHtml = "<html><head/><body><a href='" +authurl + "'>Open Studio</a>" + "</body></html>";
    console.log(authHtml);

  }           // successful response
});

	res.send(authHtml);
});


app.listen(port, () => {
	console.log("hello world")
});

