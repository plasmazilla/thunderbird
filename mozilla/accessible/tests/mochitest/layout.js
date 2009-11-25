/**
 * Tests if the given accessible at the given point is expected.
 *
 * @param aIdentifier        [in] accessible identifier
 * @param aX                 [in] x coordinate of the point relative accessible
 * @param aY                 [in] y coordinate of the point relative accessible
 * @param aTakeDeepestChild  [in] points whether deepest or nearest child should
 *                           be returned
 * @param aChildIdentifier   [in] expected child accessible
 */
function testChildAtPoint(aIdentifier, aX, aY, aTakeDeepestChild,
                          aChildIdentifier)
{
  var childAcc = getAccessible(aChildIdentifier);
  if (!childAcc)
    return;

  var actualChildAcc = getChildAtPoint(aIdentifier, aX, aY, aTakeDeepestChild);
  is(childAcc, actualChildAcc,
     "Wrong child accessible at the point (" + aX + ", " + aY + ") of accessible '" + prettyName(aIdentifier)) + "'";  
}

/**
 * Return child accessible at the given point.
 *
 * @param aIdentifier        [in] accessible identifier
 * @param aX                 [in] x coordinate of the point relative accessible
 * @param aY                 [in] y coordinate of the point relative accessible
 * @param aTakeDeepestChild  [in] points whether deepest or nearest child should
 *                           be returned
 * @return                   the child accessible at the given point
 */
function getChildAtPoint(aIdentifier, aX, aY, aTakeDeepestChild)
{
  var nodeObj = { value: null };
  var acc = getAccessible(aIdentifier, null, nodeObj);
  var node = nodeObj.value;

  if (!acc || !node)
    return;

  var deltaX = node.boxObject.screenX;
  var deltaY = node.boxObject.screenY;

  var x = deltaX + aX;
  var y = deltaY + aY;

  try {
    if (aTakeDeepestChild)
      return acc.getDeepestChildAtPoint(x, y);
    return acc.getChildAtPoint(x, y);
  } catch (e) {  }

  return null;
}
