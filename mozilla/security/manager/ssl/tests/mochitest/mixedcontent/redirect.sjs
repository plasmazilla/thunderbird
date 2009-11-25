function handleRequest(request, response)
{
  response.setStatusLine(request.httpVersion, 307, "Moved temporarly");
  response.setHeader("Location", request.queryString);
}
