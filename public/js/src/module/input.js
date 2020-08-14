// Modify the Enketo Core input module.

import inputModule from 'enketo-core/src/js/input';

// Obtain multiple constraints
inputModule.getConstraint = function( control ) {
    // The array index corresponds to the number used in oc:constraint
    // Note if a spot is missing, e.g. constraint11, this will (deliberately) result in an undefined value,
    return Array.from( Array( 21 ) ).map( ( val, i ) => i === 0 ? control.dataset.constraint : control.dataset.oc[`constraint${i}`] );
};


