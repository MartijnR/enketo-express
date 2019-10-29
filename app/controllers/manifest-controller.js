/**
 * @module manifest-controller
 */

const manifest = require( '../models/manifest-model' );
const express = require( 'express' );
const router = express.Router();
const config = require( '../models/config-model' ).server;
// var debug = require( 'debug' )( 'manifest-controller' );

module.exports = app => {
    app.use( `${app.get( 'base path' )}/fs/participant/x/manifest.appcache*`, router );
    app.use( `${app.get( 'base path' )}/x/manifest.appcache*`, router );
    // legacy:
    app.use( `${app.get( 'base path' )}/_/manifest.appcache*`, router );
};
router
    .get( '*', ( req, res, next ) => {
        if ( config[ 'offline enabled' ] === false ) {
            var error = new Error( 'Offline functionality has not been enabled for this application.' );
            error.status = 404;
            next( error );
        } else {
            getManifest( req, res )
                .then( manifestContent => {
                    res
                        .set( 'Content-Type', 'text/cache-manifest' )
                        .send( manifestContent );
                } )
                .catch( next );
        }
    } );

/**
 * @param {module:api-controller~ExpressRequest} req
 * @param {module:api-controller~ExpressResponse} res
 */
function getManifest( req, res ) {
    let options;
    if ( !req.originalUrl.includes( '/participant/' ) ) {
        options = {
            manifest: `${req.app.get( 'base path' )}/x/manifest.appcache`
        };
    } else {
        options = {
            type: 'fieldsubmission',
            participant: true,
            closeButtonIdSuffix: 'participant',
            manifest: `${req.app.get( 'base path' )}/fs/participant/x/manifest.appcache`
        };
    }
    return Promise.all( [
            _getWebformHtml( req, res, options ),
            _getOfflineFallbackHtml( req, res )
        ] )
        .then( result => {
            // TODO: if we ever start supporting dialects, we need to change this
            const lang = req.i18n.language.split( '-' )[ 0 ];
            return manifest.get( result[ 0 ], result[ 1 ], lang, options.type );
        } );
}

/**
 * @param {module:api-controller~ExpressRequest} req
 * @param {module:api-controller~ExpressResponse} res
 */
function _getWebformHtml( req, res, options = {} ) {
    return new Promise( ( resolve, reject ) => {
        res.render( 'surveys/webform', options, ( err, html ) => {
            if ( err ) {
                reject( err );
            } else {
                resolve( html );
            }
        } );
    } );
}

/**
 * @param {module:api-controller~ExpressRequest} req
 * @param {module:api-controller~ExpressResponse} res
 */
function _getOfflineFallbackHtml( req, res ) {
    return new Promise( ( resolve, reject ) => {
        res.render( 'pages/offline', {}, ( err, html ) => {
            if ( err ) {
                reject( err );
            } else {
                resolve( html );
            }
        } );
    } );
}
