# Master GitHub markdown tables with code blocks

1. Use HTML tags to define the table to get the best layout result
2. Use either backticks (\`\`\`) or the HTML `pre` element with attribute `lang`
3. Keep a blank line *before* and *after* a code block for correct formatting and syntax highlighting

> This is an intended blockquote,
> Meant to ensure tests passed
> Also so that we cover more use cases in markdown

# Good

## Example: nice looking table to show HTTP Responses

<table>
<tr>
<td> Status </td> <td> Response </td>
</tr>
<tr>
<td> 200 </td>
<td>
    
```json
{
  "id": 10,
  "username": "marcoeidinger",
  "created_at": "2021-02-097T20:45:26.433Z",
  "updated_at": "2015-02-10T19:27:16.540Z"
}
```

</td>
</tr>
<tr>
<td> 400 </td>
<td>
    
**Error**, what the hell is going on?!?
    
</td>
</tr>
<tr>
<td> 500 </td>
<td>
Internal Server Error    
</td>
</tr>
</table>

## Example: nice looking table to compare code changes

<table>
<tr>
<td> Before </td> <td> After </td>
</tr>
<tr>
<td>

```swift
struct Hello {
   public var test: String = "World" // original
}
```

</td>
<td>
    
```swift
struct Hello {
   public var test: String = "Universe" // changed
}
```
</td>
</tr>
</table>

# Bad

## Markdown defined table

Some markdown editors show correct layout and syntax highlighting if you use `<br>` tags in your code block. But this is very cumbersome and akward. And finally GitHub itself will show the code block on a single line :(

| Status | Response  |
| ------ | --------- |
| 200    |<pre lang="json">{<br>  "id": 10,<br>  "username": "alanpartridge",<br>  "email": "alan@alan.com",<br>  "password_hash": "$2a$10$uhUIUmVWVnrBWx9rrDWhS.CPCWCZsyqqa8./whhfzBZydX7yvahHS",<br>  "password_salt": "$2a$10$uhUIUmVWVnrBWx9rrDWhS.",<br>  "created_at": "2015-02-14T20:45:26.433Z",<br>  "updated_at": "2015-02-14T20:45:26.540Z"<br>}</pre>|
| 400    |**Error**, what the hell is going on?!?|


## Using HTML `code` element to wrap code

You won't get syntax highlighting :(

<table>
<tr>
<td> Status </td> <td> Response </td>
</tr>
<tr>
<td> 200 </td>
<td>
<code>
{
  "id": 10,
  "username": "marcoeidinger",
  "email": "alan@alan.com",
  "created_at": "2021-02-097T20:45:26.433Z",
  "updated_at": "2015-02-10T19:27:16.540Z"
}
</code>
</td>
</tr>
<tr>
<td> 400 </td>
<td>

**Error**, what the hell is going on?!?

</td>
</tr>
</table>

## No blank line before/after a code block

You just lost line breaks AND syntax highlighting :((

<table>
<tr>
<td> Status </td> <td> Response </td>
</tr>
<tr>
<td> 200 </td>
<td>
```json
{
  "id": 10,
  "username": "marcoeidinger",
  "email": "alan@alan.com",
  "created_at": "2021-02-097T20:45:26.433Z",
  "updated_at": "2015-02-10T19:27:16.540Z"
}
```
</td>
</tr>
<tr>
<td> 400 </td>
<td>

**Error**, what the hell is going on?!?

</td>
</tr>
</table>

### Testing Headers
This block is included so that we can validate header depth

###### This H6 should be considered too deep

#### This H4 is perfectly valid